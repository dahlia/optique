import {
  createDependencySourceState,
  dependencyId,
  isDependencySourceState,
  isPendingDependencySourceState,
  isWrappedDependencySource,
  wrappedDependencySourceMarker,
} from "./dependency.ts";
import {
  buildRuntimeNodesFromArray,
  buildRuntimeNodesFromPairs,
  collectExplicitSourceValues,
  collectExplicitSourceValuesAsync,
  collectSourcesFromState,
  createDependencyRuntimeContext,
  fillMissingSourceDefaults,
  fillMissingSourceDefaultsAsync,
  resolveStateWithRuntime,
  resolveStateWithRuntimeAsync,
  type RuntimeNode,
} from "./dependency-runtime.ts";
import {
  annotateFreshArray,
  annotationKey,
  type Annotations,
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
} from "./annotations.ts";
import { dispatchByMode, dispatchIterableByMode } from "./mode-dispatch.ts";
import {
  completeOrExtractPhase2Seed,
  extractPhase2Seed,
  extractPhase2SeedKey,
  phase2SeedFromValueResult,
} from "./phase2-seed.ts";
import type { DependencyRegistryLike } from "./registry-types.ts";
import {
  deduplicateDocFragments,
  type DocEntry,
  type DocFragment,
  type DocSection,
} from "./doc.ts";
import {
  type Message,
  message,
  optionName as eOptionName,
  text,
  values,
} from "./message.ts";
import type {
  CombineModes,
  DocState,
  ExecutionContext,
  InferValue,
  Mode,
  ModeIterable,
  ModeValue,
  Parser,
  ParserContext,
  ParserResult,
  Suggestion,
} from "./parser.ts";
import {
  defineInheritedAnnotationParser,
  getParserSuggestRuntimeNodes,
  inheritParentAnnotationsKey,
  unmatchedNonCliDependencySourceStateMarker,
} from "./parser.ts";
import type { ParserDependencyMetadata } from "./dependency-metadata.ts";

/**
 * Helper type to extract Mode from a Parser.
 * @internal
 */
type ExtractMode<T> = T extends Parser<infer M, unknown, unknown> ? M : never;

/**
 * Helper type to combine modes from an object of parsers.
 * Returns "async" if any parser is async, otherwise "sync".
 * @internal
 */
type CombineObjectModes<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
> = CombineModes<
  { [K in keyof T]: ExtractMode<T[K]> }[keyof T] extends infer M
    ? M extends Mode ? readonly [M] : never
    : never
>;

/**
 * A shared empty set used as the `leadingNames` value for parsers that
 * do not match any specific name at the first buffer position.
 */
const EMPTY_LEADING_NAMES: ReadonlySet<string> = new Set();

function isNonCliBoundSourceState(
  state: unknown,
  parser: {
    readonly [unmatchedNonCliDependencySourceStateMarker]?: true;
  },
): state is { readonly hasCliValue: false } {
  return parser[unmatchedNonCliDependencySourceStateMarker] === true &&
    state != null &&
    typeof state === "object" &&
    Object.hasOwn(state, "hasCliValue") &&
    (state as { readonly hasCliValue?: unknown }).hasCliValue === false;
}

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
  parser?: Parser<Mode, unknown, unknown>,
  usage?: Usage,
): ParserContext<TState> {
  const exec = withChildExecPath(context.exec, segment);
  const dependencyRegistry = context.dependencyRegistry ??
    exec?.dependencyRegistry;
  const childState = parser == null
    ? state
    : getParseChildState(context.state, state, parser) as TState;
  return {
    ...context,
    state: childState,
    ...(usage != null ? { usage } : {}),
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

function isUnmatchedDependencyState(
  state: unknown,
  parser: {
    readonly initialState?: unknown;
    readonly [unmatchedNonCliDependencySourceStateMarker]?: true;
  },
): boolean {
  if (state === undefined) return true;
  if (
    Array.isArray(state) &&
    state.length === 1 &&
    isPendingDependencySourceState(state[0])
  ) {
    return true;
  }
  if (isPendingDependencySourceState(state)) return true;
  if (isNonCliBoundSourceState(state, parser)) return true;
  return state === parser.initialState;
}

function filterPreCompletedRuntimeNodes<
  T extends { readonly path: readonly PropertyKey[] },
>(
  nodes: readonly T[],
  preCompletedKeys: ReadonlySet<string | symbol>,
): readonly T[] {
  if (preCompletedKeys.size < 1) return nodes;
  return nodes.filter((node) => {
    const segment = node.path.at(-1);
    if (typeof segment === "number") {
      return !preCompletedKeys.has(String(segment));
    }
    return segment == null || !preCompletedKeys.has(segment);
  });
}

function buildIndexedParserPairs<
  TParser extends Parser<Mode, unknown, unknown>,
>(
  parsers: readonly TParser[],
): readonly (readonly [string, TParser])[] {
  return parsers.map(
    (parser, index) => [String(index), parser] as const,
  );
}

function createAnnotatedArrayStateRecord(
  stateArray: readonly unknown[],
): Record<PropertyKey, unknown> {
  const stateRecord = Object.fromEntries(
    stateArray.map((state, index) => [String(index), state]),
  ) as Record<PropertyKey, unknown>;
  return inheritAnnotations(stateArray, stateRecord);
}

interface LeadingNameSource {
  readonly leadingNames: ReadonlySet<string>;
  readonly acceptingAnyToken: boolean;
  readonly priority: number;
}

/**
 * Computes the union of `leadingNames` from all given parsers.
 * Used for alternative combinators (`or()`, `longestMatch()`) where all
 * branches compete independently.
 */
function unionLeadingNames(
  parsers: readonly LeadingNameSource[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const p of parsers) {
    for (const name of p.leadingNames) names.add(name);
  }
  return names.size === 0 ? EMPTY_LEADING_NAMES : names;
}

/**
 * Computes `leadingNames` for shared-buffer compositions (`tuple()`,
 * `object()`, `merge()`, `concat()`).
 *
 * Children are processed in descending priority order (matching the
 * round-robin parse loop).  Once a child with `acceptingAnyToken` is
 * encountered, no lower-priority children can match at position 0, so
 * their names are excluded.
 */
function sharedBufferLeadingNames(
  parsers: readonly LeadingNameSource[],
): ReadonlySet<string> {
  const sorted = parsers.toSorted((a, b) => b.priority - a.priority);
  const names = new Set<string>();
  let positionalBlocked = false;
  for (const p of sorted) {
    if (p.leadingNames) {
      for (const name of p.leadingNames) {
        // After a catch-all positional parser (e.g., argument()), only
        // option-like names remain reachable because argument() rejects
        // tokens that start with "-".
        if (positionalBlocked && !name.startsWith("-")) continue;
        names.add(name);
      }
    }
    if (p.acceptingAnyToken) positionalBlocked = true;
  }
  return names.size === 0 ? EMPTY_LEADING_NAMES : names;
}

/**
 * Internal symbol for exposing field-level parser pairs from `object()`
 * and `merge()` parsers.  This allows `merge()` to pre-complete dependency
 * source fields from child parsers before resolving deferred states.
 * @internal
 */
const fieldParsersKey: unique symbol = Symbol("fieldParsers");

/**
 * Extracts the actual {@link ValueParserResult} from a `complete()` return
 * value, which may be a plain result or a `DependencySourceState` wrapper
 * from the old protocol.  This bridge helper allows the new runtime path
 * to consume results from parsers that still return `DependencySourceState`.
 * @internal
 */
function unwrapAnnotationView<T>(value: T): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  return (annotationViewTargets.get(value as object) as T | undefined) ?? value;
}

function containsAnnotationView(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const candidate = value as object;
  if (annotationViewTargets.has(candidate)) {
    return true;
  }
  const source = unwrapAnnotationView(candidate);
  if (seen.has(source)) {
    return false;
  }
  seen.add(source);
  if (Array.isArray(source)) {
    return source.some((item) => containsAnnotationView(item, seen));
  }
  const proto = Object.getPrototypeOf(source);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  const descriptors = Object.getOwnPropertyDescriptors(source) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  return Reflect.ownKeys(descriptors).some((key) => {
    const descriptor = descriptors[key];
    return descriptor != null && "value" in descriptor
      ? containsAnnotationView(descriptor.value, seen)
      : false;
  });
}

function unwrapNestedAnnotationViews<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  const source = unwrapAnnotationView(value as object);
  if (seen.has(source)) {
    return seen.get(source) as T;
  }
  if (Array.isArray(source)) {
    let changed = false;
    const clone = [...source];
    seen.set(source, clone);
    for (let i = 0; i < source.length; i++) {
      const nextValue = unwrapNestedAnnotationViews(source[i], seen);
      if (nextValue !== source[i]) {
        clone[i] = nextValue;
        changed = true;
      }
    }
    if (!changed) {
      seen.set(source, source);
      return source as T;
    }
    return clone as T;
  }
  const proto = Object.getPrototypeOf(source);
  if (proto !== Object.prototype && proto !== null) {
    return source as T;
  }
  const descriptors = Object.getOwnPropertyDescriptors(source) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  let changed = false;
  const clone = Object.create(proto);
  seen.set(source, clone);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (descriptor != null && "value" in descriptor) {
      const nextValue = unwrapNestedAnnotationViews(descriptor.value, seen);
      if (nextValue !== descriptor.value) {
        descriptors[key] = { ...descriptor, value: nextValue };
        changed = true;
      }
    }
  }
  if (!changed) {
    seen.set(source, source);
    return source as T;
  }
  Object.defineProperties(clone, descriptors);
  return clone as T;
}

function unwrapCompleteResult(
  result: unknown,
): import("./valueparser.ts").ValueParserResult<unknown> {
  const unwrappedResult = isDependencySourceState(result)
    ? result.result
    : result as import("./valueparser.ts").ValueParserResult<unknown>;
  if (
    !unwrappedResult.success ||
    !containsAnnotationView(unwrappedResult.value)
  ) {
    return unwrappedResult;
  }
  const value = unwrapNestedAnnotationViews(unwrappedResult.value);
  return value === unwrappedResult.value ? unwrappedResult : {
    ...unwrappedResult,
    value,
  };
}

function reusePreCompletedPhase2Seed(
  parser: Parser<"sync", unknown, unknown>,
  state: unknown,
  preCompletedResult: unknown,
  exec?: ExecutionContext,
) {
  const result = unwrapCompleteResult(preCompletedResult);
  return result.success
    ? phase2SeedFromValueResult(result)
    : extractPhase2Seed(parser, state, exec);
}

async function reusePreCompletedPhase2SeedAsync(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
  preCompletedResult: unknown,
  exec?: ExecutionContext,
) {
  const result = unwrapCompleteResult(preCompletedResult);
  return result.success
    ? phase2SeedFromValueResult(result)
    : await extractPhase2Seed(parser, state, exec);
}

/**
 * Prepares a field state for completion by wrapping `undefined` state
 * with the parser's initial pending dependency state when needed.
 *
 * In the old protocol, when a parser has a `PendingDependencySourceState`
 * as its initial state and the field state is `undefined` (option not
 * provided), the construct wraps it as `[initialState]` so that
 * `withDefault().complete()` can detect the pending dependency and
 * return a `DependencySourceState` with the default value.
 * @internal
 */
function prepareStateForCompletion(
  fieldState: unknown,
  parser: Parser<Mode, unknown, unknown>,
): unknown {
  if (fieldState !== undefined) return fieldState;
  if (isPendingDependencySourceState(parser.initialState)) {
    return [parser.initialState];
  }
  if (isWrappedDependencySource(parser)) {
    return [parser[wrappedDependencySourceMarker]];
  }
  return fieldState;
}

/**
 * Returns the field state with parent annotations inherited, respecting
 * the parser's annotation-inheritance contract. This is the same logic as
 * {@link createFieldStateGetter} inside `object()` but without the per-state
 * cache, for use in module-level helpers like
 * {@link pendingDependencyDefaults}.
 * @internal
 */
function getAnnotatedFieldState(
  parentState: unknown,
  field: string | symbol,
  parser: Parser<Mode, unknown, unknown>,
): unknown {
  const sourceState = parentState != null &&
      typeof parentState === "object" &&
      field in parentState
    ? (parentState as Record<string | symbol, unknown>)[field]
    : parser.initialState;
  return getAnnotatedChildState(parentState, sourceState, parser);
}

const annotationViewTargets = new WeakMap<object, object>();

function withAnnotationView<T extends object>(
  state: T,
  annotations: Annotations,
): T {
  const target = unwrapAnnotationView(state) as T;
  const view = new Proxy(target, {
    get(target, key) {
      if (key === annotationKey) {
        return annotations;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, key) {
      return key === annotationKey || Reflect.has(target, key);
    },
  });
  annotationViewTargets.set(view, target);
  return view;
}

function getParseChildState(
  parentState: unknown,
  childState: unknown,
  parser: Parser<Mode, unknown, unknown>,
): unknown {
  const annotations = getAnnotations(parentState);
  const shouldInheritAnnotations =
    Reflect.get(parser, inheritParentAnnotationsKey) === true;
  if (childState == null) {
    if (annotations !== undefined && shouldInheritAnnotations) {
      return injectAnnotations({}, annotations);
    }
    return childState;
  }
  if (
    annotations === undefined ||
    typeof childState !== "object" ||
    getAnnotations(childState) === annotations ||
    !shouldInheritAnnotations
  ) {
    return childState;
  }
  const injectedState = injectAnnotations(childState, annotations);
  return getAnnotations(injectedState) === annotations
    ? injectedState
    : childState;
}

function getObjectParseChildState(
  parentState: unknown,
  childState: unknown,
  _parser: Parser<Mode, unknown, unknown>,
): unknown {
  const annotations = getAnnotations(parentState);
  if (
    annotations === undefined ||
    childState == null ||
    typeof childState !== "object" ||
    getAnnotations(childState) === annotations
  ) {
    return childState;
  }
  return inheritAnnotations(parentState, childState);
}

function getAnnotatedChildState(
  parentState: unknown,
  childState: unknown,
  parser: Parser<Mode, unknown, unknown>,
): unknown {
  const annotations = getAnnotations(parentState);
  const shouldInheritAnnotations =
    Reflect.get(parser, inheritParentAnnotationsKey) === true;
  if (childState == null) {
    if (annotations !== undefined && shouldInheritAnnotations) {
      return injectAnnotations({}, annotations);
    }
    return childState;
  }
  if (typeof childState !== "object") {
    return childState;
  }
  if (
    annotations === undefined || getAnnotations(childState) === annotations
  ) {
    return childState;
  }
  if (shouldInheritAnnotations) {
    const injectedState = injectAnnotations(childState, annotations);
    if (getAnnotations(injectedState) === annotations) {
      return injectedState;
    }
  }
  return withAnnotationView(childState, annotations);
}

function buildSuggestRuntimeNodesFromPairs(
  pairs: ReadonlyArray<
    readonly [PropertyKey, Parser<Mode, unknown, unknown>]
  >,
  state: Record<PropertyKey, unknown>,
  parentPath?: readonly PropertyKey[],
): readonly RuntimeNode[] {
  const prefix = parentPath ?? [];
  const nodes: RuntimeNode[] = [];
  for (const [field, parser] of pairs) {
    const fieldState = Object.hasOwn(state, field)
      ? state[field]
      : parser.initialState;
    nodes.push(
      ...getParserSuggestRuntimeNodes(
        parser,
        getAnnotatedChildState(state, fieldState, parser),
        [...prefix, field],
      ),
    );
  }
  return nodes;
}

function buildSuggestRuntimeNodesFromArray(
  parsers: readonly Parser<Mode, unknown, unknown>[],
  stateArray: readonly unknown[],
  parentPath?: readonly PropertyKey[],
): readonly RuntimeNode[] {
  const prefix = parentPath ?? [];
  const nodes: RuntimeNode[] = [];
  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const elementState = i < stateArray.length ? stateArray[i] : undefined;
    nodes.push(
      ...getParserSuggestRuntimeNodes(
        parser,
        getAnnotatedChildState(stateArray, elementState, parser),
        [...prefix, i],
      ),
    );
  }
  return nodes;
}

/**
 * Helper type to combine modes from a tuple of parsers.
 * Returns "async" if any parser is async, otherwise "sync".
 * @internal
 */
type CombineTupleModes<T extends readonly Parser<Mode, unknown, unknown>[]> =
  CombineModes<{ readonly [K in keyof T]: ExtractMode<T[K]> }>;
import {
  createErrorWithSuggestions,
  createSuggestionMessage,
  deduplicateSuggestions,
  DEFAULT_FIND_SIMILAR_OPTIONS,
  findSimilar,
} from "./suggestion.ts";
import {
  extractArgumentMetavars,
  extractCommandNames,
  extractOptionNames,
  type HiddenVisibility,
  isDocHidden,
  mergeHidden,
  type Usage,
  type UsageTerm,
} from "./usage.ts";
import { collectLeadingCandidates } from "./usage-internals.ts";
import { validateLabel } from "./validate.ts";

function createUnexpectedInputErrorWithScopedSuggestions(
  baseError: Message,
  invalidInput: string,
  parsers: readonly Parser<Mode, unknown, unknown>[],
  customFormatter?: (suggestions: readonly string[]) => Message,
): Message {
  const options = new Set<string>();
  const commands = new Set<string>();

  for (const parser of parsers) {
    collectLeadingCandidates(parser.usage, options, commands);
  }

  const candidates = new Set<string>([...options, ...commands]);
  const suggestions = findSimilar(
    invalidInput,
    candidates,
    DEFAULT_FIND_SIMILAR_OPTIONS,
  );
  const suggestionMsg = customFormatter
    ? customFormatter(suggestions)
    : createSuggestionMessage(suggestions);

  return suggestionMsg.length > 0
    ? [...baseError, text("\n\n"), ...suggestionMsg]
    : baseError;
}

function applyHiddenToUsageTerm(
  term: UsageTerm,
  hidden: HiddenVisibility | undefined,
): UsageTerm {
  if (hidden == null) return term;
  if (term.type === "optional") {
    return {
      type: "optional",
      terms: applyHiddenToUsage(term.terms, hidden),
    };
  }
  if (term.type === "multiple") {
    return {
      type: "multiple",
      terms: applyHiddenToUsage(term.terms, hidden),
      min: term.min,
    };
  }
  if (term.type === "exclusive") {
    return {
      type: "exclusive",
      terms: term.terms.map((u) => applyHiddenToUsage(u, hidden)),
    };
  }
  if (
    term.type === "argument" || term.type === "option" ||
    term.type === "command" ||
    term.type === "passthrough"
  ) {
    return {
      ...term,
      hidden: mergeHidden(term.hidden, hidden),
    };
  }
  return term;
}

function applyHiddenToUsage(
  usage: Usage,
  hidden: HiddenVisibility | undefined,
): Usage {
  if (hidden == null) return usage;
  return usage.map((term) => applyHiddenToUsageTerm(term, hidden));
}

function applyHiddenToDocEntry(
  entry: DocEntry,
  hidden: HiddenVisibility | undefined,
): DocEntry | undefined {
  const mergedTerm = applyHiddenToUsageTerm(entry.term, hidden);
  if (
    (mergedTerm.type === "argument" || mergedTerm.type === "option" ||
      mergedTerm.type === "command" || mergedTerm.type === "passthrough") &&
    isDocHidden(mergedTerm.hidden)
  ) {
    return undefined;
  }
  return { ...entry, term: mergedTerm };
}

function applyHiddenToDocFragments(
  fragments: readonly DocFragment[],
  hidden: HiddenVisibility | undefined,
): readonly DocFragment[] {
  if (hidden == null) return fragments;
  const result: DocFragment[] = [];
  for (const fragment of fragments) {
    if (fragment.type === "entry") {
      const entry = applyHiddenToDocEntry(fragment, hidden);
      if (entry != null) result.push({ ...entry, type: "entry" });
      continue;
    }
    const entries = fragment.entries
      .map((entry) => applyHiddenToDocEntry(entry, hidden))
      .filter((entry): entry is DocEntry => entry != null);
    result.push({
      type: "section",
      title: fragment.title,
      entries,
    });
  }
  return result;
}

/**
 * Checks if the given token is an option name that requires a value
 * (i.e., has a metavar) within the given usage terms.
 * @param usage The usage terms to search through.
 * @param token The token to check.
 * @returns `true` if the token is an option that requires a value, `false` otherwise.
 */
function isOptionRequiringValue(usage: Usage, token: string): boolean {
  function traverse(terms: Usage): boolean {
    if (!terms || !Array.isArray(terms)) return false;
    for (const term of terms) {
      if (term.type === "option") {
        // Option requires a value if it has a metavar
        if (term.metavar && term.names.includes(token)) {
          return true;
        }
      } else if (term.type === "optional" || term.type === "multiple") {
        if (traverse(term.terms)) return true;
      } else if (term.type === "exclusive") {
        for (const exclusiveUsage of term.terms) {
          if (traverse(exclusiveUsage)) return true;
        }
      }
    }
    return false;
  }

  return traverse(usage);
}
import type { DeferredMap, ValueParserResult } from "./valueparser.ts";

/**
 * Options for customizing error messages in the {@link or} combinator.
 * @since 0.5.0
 */
export interface OrOptions {
  /**
   * Error message customization options.
   */
  errors?: OrErrorOptions;
}

/**
 * Context information about what types of inputs are expected,
 * used for generating contextual error messages.
 * @since 0.7.0
 */
export interface NoMatchContext {
  /**
   * Whether any of the parsers expect options.
   */
  readonly hasOptions: boolean;

  /**
   * Whether any of the parsers expect commands.
   */
  readonly hasCommands: boolean;

  /**
   * Whether any of the parsers expect arguments.
   */
  readonly hasArguments: boolean;
}

/**
 * Options for customizing error messages in the {@link or} parser.
 * @since 0.5.0
 */
export interface OrErrorOptions {
  /**
   * Custom error message when no parser matches.
   * Can be a static message or a function that receives context about what
   * types of inputs are expected, allowing for more precise error messages.
   *
   * @example
   * ```typescript
   * // Static message (overrides all cases)
   * { noMatch: message`Invalid input.` }
   *
   * // Dynamic message based on context (for i18n, etc.)
   * {
   *   noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
   *     if (hasArguments && !hasOptions && !hasCommands) {
   *       return message`인수가 필요합니다.`; // Korean: "Argument required"
   *     }
   *     // ... other cases
   *   }
   * }
   * ```
   * @since 0.9.0 - Function form added
   */
  noMatch?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom error message for unexpected input.
   * Can be a static message or a function that receives the unexpected token.
   */
  unexpectedInput?: Message | ((token: string) => Message);

  /**
   * Custom function to format suggestion messages.
   * If provided, this will be used instead of the default "Did you mean?"
   * formatting. The function receives an array of similar valid options/commands
   * and should return a formatted message to append to the error.
   *
   * @param suggestions Array of similar valid option/command names
   * @returns Formatted message to append to the error (can be empty array for no suggestions)
   * @since 0.7.0
   */
  suggestions?: (suggestions: readonly string[]) => Message;
}

/**
 * Extracts required (non-optional) usage terms from a usage array.
 * @param usage The usage to extract required terms from
 * @returns Usage containing only required (non-optional) terms
 */
function extractRequiredUsage(usage: Usage): Usage {
  const required: UsageTerm[] = [];

  for (const term of usage) {
    if (term.type === "optional") {
      // Skip optional terms
      continue;
    } else if (term.type === "exclusive") {
      // For exclusive terms, recursively extract required usage from each branch
      const requiredBranches = term.terms
        .map((branch) => extractRequiredUsage(branch))
        .filter((branch) => branch.length > 0);
      if (requiredBranches.length > 0) {
        required.push({ type: "exclusive", terms: requiredBranches });
      }
    } else if (term.type === "multiple") {
      // For multiple terms, only include if min > 0 (required)
      if (term.min > 0) {
        const requiredTerms = extractRequiredUsage(term.terms);
        if (requiredTerms.length > 0) {
          required.push({
            type: "multiple",
            terms: requiredTerms,
            min: term.min,
          });
        }
      }
    } else {
      // Include other terms (argument, option, command) as-is
      required.push(term);
    }
  }

  return required;
}

/**
 * Validates that every element of the given array is a {@link Parser} object.
 * @param parsers The array of values to validate.
 * @param callerName The name of the calling function, used in error messages.
 * @throws {TypeError} If any element is not a valid {@link Parser}.
 */
function assertParsers(
  parsers: readonly unknown[],
  callerName: string,
): void {
  for (let i = 0; i < parsers.length; i++) {
    const p = parsers[i];
    const r = p as Record<string, unknown>;
    if (
      p == null ||
      (typeof p !== "object" && typeof p !== "function") ||
      !(r.$mode === "sync" || r.$mode === "async") ||
      !Array.isArray(r.usage) ||
      typeof r.priority !== "number" || Number.isNaN(r.priority) ||
      !("initialState" in p) ||
      typeof r.parse !== "function" ||
      typeof r.complete !== "function" ||
      typeof r.suggest !== "function" ||
      typeof r.getDocFragments !== "function"
    ) {
      throw new TypeError(
        `${callerName} argument at index ${i} is not a valid Parser.`,
      );
    }
  }
}

/**
 * Analyzes parsers to determine what types of inputs are expected.
 * @param parsers The parsers being combined
 * @returns Context about what types of inputs are expected
 */
function analyzeNoMatchContext(
  parsers: Parser<Mode, unknown, unknown>[],
): NoMatchContext {
  // Collect usage information from all child parsers
  const combinedUsage = [
    { type: "exclusive" as const, terms: parsers.map((p) => p.usage) },
  ];

  // Extract only required (non-optional) terms for more accurate error messages
  const requiredUsage = extractRequiredUsage(combinedUsage);

  return {
    hasOptions: extractOptionNames(requiredUsage).size > 0,
    hasCommands: extractCommandNames(requiredUsage).size > 0,
    hasArguments: extractArgumentMetavars(requiredUsage).size > 0,
  };
}

/**
 * Error class thrown when duplicate option names are detected during parser
 * construction. This is a programmer error, not a user error.
 */
export class DuplicateOptionError extends Error {
  constructor(
    public readonly optionName: string,
    public readonly sources: readonly (string | symbol)[],
  ) {
    const sourceNames = sources.map((s) =>
      typeof s === "symbol" ? s.description ?? s.toString() : s
    );
    super(
      `Duplicate option name "${optionName}" found in fields: ` +
        `${sourceNames.join(", ")}. Each option name must be unique within a ` +
        `parser combinator.`,
    );
    this.name = "DuplicateOptionError";
  }
}

/**
 * Checks for duplicate option names across parser sources and throws an error
 * if duplicates are found. This should be called at construction time.
 * @param parserSources Array of [source, usage] tuples
 * @throws DuplicateOptionError if duplicate option names are found
 */
function checkDuplicateOptionNames(
  parserSources: ReadonlyArray<readonly [string | symbol, Usage]>,
): void {
  const optionNameSources = new Map<string, (string | symbol)[]>();

  for (const [source, usage] of parserSources) {
    const names = extractOptionNames(usage);
    for (const name of names) {
      if (!optionNameSources.has(name)) {
        optionNameSources.set(name, []);
      }
      optionNameSources.get(name)!.push(source);
    }
  }

  // Check for duplicates
  for (const [name, sources] of optionNameSources) {
    if (sources.length > 1) {
      throw new DuplicateOptionError(name, sources);
    }
  }
}

/**
 * Generates a contextual error message based on what types of inputs
 * the parsers expect (options, commands, or arguments).
 * @param context Context about what types of inputs are expected
 * @returns An appropriate error message
 */
function generateNoMatchError(context: NoMatchContext): Message {
  const { hasOptions, hasCommands, hasArguments } = context;

  // Generate specific message based on what's expected
  if (hasArguments && !hasOptions && !hasCommands) {
    return message`Missing required argument.`;
  } else if (hasCommands && !hasOptions && !hasArguments) {
    return message`No matching command found.`;
  } else if (hasOptions && !hasCommands && !hasArguments) {
    return message`No matching option found.`;
  } else if (hasCommands && hasOptions && !hasArguments) {
    return message`No matching option or command found.`;
  } else if (hasArguments && hasOptions && !hasCommands) {
    return message`No matching option or argument found.`;
  } else if (hasArguments && hasCommands && !hasOptions) {
    return message`No matching command or argument found.`;
  } else {
    // All three types present
    return message`No matching option, command, or argument found.`;
  }
}

/**
 * Shared state type for or() and longestMatch() combinators.
 * @internal
 */
type ExclusiveState = undefined | [number, ParserResult<unknown>];

/**
 * Options type for exclusive combinators (or/longestMatch).
 * @internal
 */
interface ExclusiveErrorOptions {
  noMatch?: Message | ((context: NoMatchContext) => Message);
  unexpectedInput?: Message | ((token: string) => Message);
  suggestions?: (suggestions: readonly string[]) => Message;
}

function normalizeExclusiveState(state: unknown): ExclusiveState {
  if (
    !Array.isArray(state) ||
    state.length !== 2 ||
    typeof state[0] !== "number"
  ) {
    return undefined;
  }
  return state as ExclusiveState;
}

function annotateExclusiveParserResult(
  parentState: unknown,
  parser: Parser<Mode, unknown, unknown>,
  result: ParserResult<unknown>,
): ParserResult<unknown> {
  if (!result.success) {
    return result;
  }
  const annotatedState = getAnnotatedChildState(
    parentState,
    result.next.state,
    parser,
  );
  if (annotatedState === result.next.state) {
    return result;
  }
  return {
    ...result,
    next: { ...result.next, state: annotatedState },
  };
}

function createExclusiveState(
  parentState: unknown,
  index: number,
  parser: Parser<Mode, unknown, unknown>,
  result: ParserResult<unknown>,
): ExclusiveState {
  const annotatedResult = annotateExclusiveParserResult(
    parentState,
    parser,
    result,
  );
  return annotateFreshArray(
    parentState,
    [index, annotatedResult],
  ) as ExclusiveState;
}

/**
 * Creates a complete() method shared by or() and longestMatch().
 * @internal
 */
function createExclusiveComplete(
  parsers: Parser<Mode, unknown, unknown>[],
  options: { errors?: ExclusiveErrorOptions } | undefined,
  noMatchContext: NoMatchContext,
  mode: Mode,
): (
  state: ExclusiveState,
  exec?: ExecutionContext,
) => ValueParserResult<unknown> | Promise<ValueParserResult<unknown>> {
  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];
  return (state, exec?) => {
    const activeState = normalizeExclusiveState(state);
    if (activeState == null) {
      // Deferred fallback: parse then complete each non-interactive
      // branch on empty input.  This resolves zero-consumed branches
      // (e.g., constant(), optional(constant())) without committing
      // exclusive state during parse, keeping all branches visible
      // in suggestions and doc generation.
      //
      // Only accept the fallback when exactly one candidate succeeds
      // (matching the parse-time ambiguity check).  When the unique
      // candidate's complete() fails, preserve its error instead of
      // falling back to a generic no-match message.
      return dispatchByMode(
        mode,
        () => {
          const emptyCtx = {
            buffer: [] as string[],
            optionsTerminated: false,
            usage: [] as never[],
            exec,
            dependencyRegistry: exec?.dependencyRegistry,
          };
          // Single pass: count candidates and cache the first result.
          let candidateIndex = -1;
          let candidateCount = 0;
          let candidateParseResult:
            | (ParserResult<unknown> & { success: true })
            | undefined;
          for (let i = 0; i < syncParsers.length; i++) {
            const p = syncParsers[i];
            if (p.leadingNames.size > 0 || p.acceptingAnyToken) continue;
            const parseResult = p.parse({
              ...emptyCtx,
              state: getAnnotatedChildState(state, p.initialState, p),
            });
            if (!parseResult.success || parseResult.provisional) continue;
            candidateCount++;
            if (candidateIndex < 0) {
              candidateIndex = i;
              candidateParseResult = parseResult;
            }
            if (candidateCount > 1) break;
          }
          // Complete only the unique candidate.
          if (
            candidateCount === 1 && candidateIndex >= 0 &&
            candidateParseResult
          ) {
            const p = syncParsers[candidateIndex];
            const annotatedState = getAnnotatedChildState(
              state,
              candidateParseResult.next.state,
              p,
            );
            return p.complete(
              annotatedState,
              withChildExecPath(exec, candidateIndex),
            );
          }
          return {
            success: false as const,
            error: getNoMatchError(options, noMatchContext),
          };
        },
        async () => {
          const emptyCtx = {
            buffer: [] as string[],
            optionsTerminated: false,
            usage: [] as never[],
            exec,
            dependencyRegistry: exec?.dependencyRegistry,
          };
          // Single pass: count candidates and cache the first result
          // (see sync counterpart).
          let candidateIndex = -1;
          let candidateCount = 0;
          let candidateParseResult:
            | (ParserResult<unknown> & { success: true })
            | undefined;
          for (let i = 0; i < parsers.length; i++) {
            const p = parsers[i];
            if (p.leadingNames.size > 0 || p.acceptingAnyToken) continue;
            const parseResult = await p.parse({
              ...emptyCtx,
              state: getAnnotatedChildState(state, p.initialState, p),
            });
            if (!parseResult.success || parseResult.provisional) continue;
            candidateCount++;
            if (candidateIndex < 0) {
              candidateIndex = i;
              candidateParseResult = parseResult;
            }
            if (candidateCount > 1) break;
          }
          // Complete only the unique candidate.
          // Skip async candidates during parse/suggest probes to
          // avoid triggering side effects (e.g., prompt()) before
          // the real completion phase.  Sync candidates are safe
          // to complete during probes (needed for object()'s
          // completability check on empty input).
          if (
            candidateCount === 1 && candidateIndex >= 0 &&
            candidateParseResult &&
            (parsers[candidateIndex].$mode === "sync" ||
              (exec?.phase !== "parse" && exec?.phase !== "suggest"))
          ) {
            const p = parsers[candidateIndex];
            const annotatedState = getAnnotatedChildState(
              state,
              candidateParseResult.next.state,
              p,
            );
            return await p.complete(
              annotatedState,
              withChildExecPath(exec, candidateIndex),
            );
          }
          return {
            success: false as const,
            error: getNoMatchError(options, noMatchContext),
          };
        },
      );
    }
    const [i, result] = activeState;
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return dispatchByMode(
      mode,
      () =>
        syncParsers[i].complete(
          result.next.state,
          withChildExecPath(exec, i),
        ),
      async () => {
        const completeResult = await parsers[i].complete(
          result.next.state,
          withChildExecPath(exec, i),
        );
        return completeResult;
      },
    );
  };
}

/**
 * Creates a suggest() method shared by or() and longestMatch().
 * @internal
 */
function createExclusiveSuggest(
  parsers: Parser<Mode, unknown, unknown>[],
  mode: Mode,
): (
  context: ParserContext<ExclusiveState>,
  prefix: string,
) => ModeIterable<Mode, Suggestion> {
  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];

  return (context, prefix) => {
    return dispatchIterableByMode(
      mode,
      function* () {
        const suggestions: Suggestion[] = [];
        const activeState = normalizeExclusiveState(context.state);

        // When the active branch consumed nothing (zero-consumed
        // fallback), treat it as provisional and show suggestions from
        // all branches so that consuming alternatives remain visible.
        if (
          activeState == null ||
          (activeState[1].success && activeState[1].consumed.length === 0)
        ) {
          // No parser has been selected yet (or selection is provisional)
          for (let i = 0; i < syncParsers.length; i++) {
            const parser = syncParsers[i];
            const parserSuggestions = parser.suggest(
              withChildContext(context, i, parser.initialState, parser),
              prefix,
            );
            suggestions.push(...parserSuggestions);
          }
        } else {
          // A parser has been selected, delegate to that parser
          const [index, parserResult] = activeState;
          if (parserResult.success) {
            const parser = syncParsers[index];
            const parserSuggestions = parser.suggest(
              withChildContext(
                context,
                index,
                parserResult.next.state,
                parser,
              ),
              prefix,
            );
            suggestions.push(...parserSuggestions);
          }
        }

        yield* deduplicateSuggestions(suggestions);
      },
      async function* () {
        const suggestions: Suggestion[] = [];
        const activeState = normalizeExclusiveState(context.state);

        // See sync counterpart for rationale.
        if (
          activeState == null ||
          (activeState[1].success && activeState[1].consumed.length === 0)
        ) {
          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserSuggestions = parser.suggest(
              withChildContext(context, i, parser.initialState, parser),
              prefix,
            );
            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }
        } else {
          // A parser has been selected, delegate to that parser
          const [index, parserResult] = activeState;
          if (parserResult.success) {
            const parser = parsers[index];
            const parserSuggestions = parser.suggest(
              withChildContext(
                context,
                index,
                parserResult.next.state,
                parser,
              ),
              prefix,
            );
            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }
        }

        yield* deduplicateSuggestions(suggestions);
      },
    );
  };
}

function getExclusiveSuggestRuntimeNodes(
  parsers: readonly Parser<Mode, unknown, unknown>[],
  state: ExclusiveState,
  path: readonly PropertyKey[],
): readonly RuntimeNode[] {
  const activeState = normalizeExclusiveState(state);
  if (activeState == null) {
    return [];
  }
  const [index, parserResult] = activeState;
  if (
    !parserResult?.success ||
    index < 0 ||
    index >= parsers.length
  ) {
    return [];
  }
  const parser = parsers[index];
  return getParserSuggestRuntimeNodes(
    parser,
    parserResult.next.state,
    [...path, index],
  );
}

function extractExclusivePhase2Seed(
  parsers: readonly Parser<Mode, unknown, unknown>[],
  state: ExclusiveState,
  exec: ExecutionContext | undefined,
  mode: Mode,
): ModeValue<Mode, import("./phase2-seed.ts").Phase2Seed<unknown> | null> {
  const activeState = normalizeExclusiveState(state);
  if (activeState == null || !activeState[1].success) {
    return dispatchByMode(mode, () => null, () => Promise.resolve(null));
  }
  const [index, parserResult] = activeState;
  return completeOrExtractPhase2Seed(
    parsers[index],
    parserResult.next.state,
    withChildExecPath(exec, index),
  );
}

/**
 * Gets the no-match error, either from custom options or default.
 * Shared by or() and longestMatch().
 * @internal
 */
function getNoMatchError(
  options: { errors?: ExclusiveErrorOptions } | undefined,
  noMatchContext: NoMatchContext,
): Message {
  const customNoMatch = options?.errors?.noMatch;
  return customNoMatch
    ? (typeof customNoMatch === "function"
      ? customNoMatch(noMatchContext)
      : customNoMatch)
    : generateNoMatchError(noMatchContext);
}

function composeExclusiveDependencyMetadata(
  parsers: readonly Parser<Mode, unknown, unknown>[],
): ParserDependencyMetadata | undefined {
  const sourceBranches = parsers.filter((parser) =>
    parser.dependencyMetadata?.source != null
  );
  if (sourceBranches.length < 1) return undefined;
  const sourceIds = new Set(
    sourceBranches.map((parser) => parser.dependencyMetadata!.source!.sourceId),
  );
  if (sourceIds.size !== 1) return undefined;
  const sharedSource = sourceBranches[0].dependencyMetadata!.source!;
  return {
    source: {
      ...sharedSource,
      getMissingSourceValue: undefined,
      preservesSourceValue: sourceBranches.every((parser) =>
        parser.dependencyMetadata?.source?.preservesSourceValue !== false
      ),
      extractSourceValue(state) {
        if (
          !Array.isArray(state) || state.length !== 2 ||
          typeof state[0] !== "number"
        ) {
          return undefined;
        }
        const [index, parserResult] = state as [number, ParserResult<unknown>];
        if (!parserResult?.success) return undefined;
        const branchSource = parsers[index].dependencyMetadata?.source;
        if (branchSource?.extractSourceValue == null) return undefined;
        return branchSource.extractSourceValue(parserResult.next.state);
      },
    },
  };
}

type OrParserArity =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;
type OrArityLimitError = {
  readonly __optiqueOrArityLimit:
    "or() requires between 1 and 15 parser arguments. Nest or() to combine more.";
};
type OrTailOptions = OrOptions & { readonly $valueType?: never };
type IsTuple<T extends readonly unknown[]> = number extends T["length"] ? false
  : true;
type OrArityGuard<TParsers extends readonly unknown[]> =
  IsTuple<TParsers> extends true
    ? TParsers["length"] extends OrParserArity ? unknown : OrArityLimitError
    : unknown;

/**
 * Creates a parser that combines two mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  TA,
  TB,
  TStateA,
  TStateB,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
): Parser<
  CombineModes<readonly [MA, MB]>,
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  TA,
  TB,
  TC,
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
): Parser<
  CombineModes<readonly [MA, MB, MC]>,
  TA | TB | TC,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
>;

/**
 * Creates a parser that combines four mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  TA,
  TB,
  TC,
  TD,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD]>,
  TA | TB | TC | TD,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
>;

/**
 * Creates a parser that combines five mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME]>,
  TA | TB | TC | TD | TE,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
>;

/**
 * Creates a parser that combines six mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF]>,
  TA | TB | TC | TD | TE | TF,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
>;

/**
 * Creates a parser that combines seven mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG]>,
  TA | TB | TC | TD | TE | TF | TG,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
>;

/**
 * Creates a parser that combines eight mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH]>,
  TA | TB | TC | TD | TE | TF | TG | TH,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
>;

/**
 * Creates a parser that combines nine mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI]>,
  TA | TB | TC | TD | TE | TF | TG | TH | TI,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
>;

/**
 * Creates a parser that combines ten mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 0.3.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI, MJ]>,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
>;

/**
 * Creates a parser that combines eleven mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template MK The mode of the eleventh parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TK The type of the value returned by the eleventh parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @template TStateK The type of the state used by the eleventh parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @param k The eleventh {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 1.0.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  MK extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TK,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
  TStateK,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
  k: Parser<MK, TK, TStateK>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI, MJ, MK]>,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ | TK,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
  | [10, ParserResult<TStateK>]
>;

/**
 * Creates a parser that combines twelve mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template MK The mode of the eleventh parser.
 * @template ML The mode of the twelfth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TK The type of the value returned by the eleventh parser.
 * @template TL The type of the value returned by the twelfth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @template TStateK The type of the state used by the eleventh parser.
 * @template TStateL The type of the state used by the twelfth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @param k The eleventh {@link Parser} to try.
 * @param l The twelfth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 1.0.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  MK extends Mode,
  ML extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TK,
  TL,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
  TStateK,
  TStateL,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
  k: Parser<MK, TK, TStateK>,
  l: Parser<ML, TL, TStateL>,
): Parser<
  CombineModes<readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI, MJ, MK, ML]>,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ | TK | TL,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
  | [10, ParserResult<TStateK>]
  | [11, ParserResult<TStateL>]
>;

/**
 * Creates a parser that combines thirteen mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template MK The mode of the eleventh parser.
 * @template ML The mode of the twelfth parser.
 * @template MM The mode of the thirteenth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TK The type of the value returned by the eleventh parser.
 * @template TL The type of the value returned by the twelfth parser.
 * @template TM The type of the value returned by the thirteenth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @template TStateK The type of the state used by the eleventh parser.
 * @template TStateL The type of the state used by the twelfth parser.
 * @template TStateM The type of the state used by the thirteenth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @param k The eleventh {@link Parser} to try.
 * @param l The twelfth {@link Parser} to try.
 * @param m The thirteenth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 1.0.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  MK extends Mode,
  ML extends Mode,
  MM extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TK,
  TL,
  TM,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
  TStateK,
  TStateL,
  TStateM,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
  k: Parser<MK, TK, TStateK>,
  l: Parser<ML, TL, TStateL>,
  m: Parser<MM, TM, TStateM>,
): Parser<
  CombineModes<
    readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI, MJ, MK, ML, MM]
  >,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ | TK | TL | TM,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
  | [10, ParserResult<TStateK>]
  | [11, ParserResult<TStateL>]
  | [12, ParserResult<TStateM>]
>;

/**
 * Creates a parser that combines fourteen mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template MK The mode of the eleventh parser.
 * @template ML The mode of the twelfth parser.
 * @template MM The mode of the thirteenth parser.
 * @template MN The mode of the fourteenth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TK The type of the value returned by the eleventh parser.
 * @template TL The type of the value returned by the twelfth parser.
 * @template TM The type of the value returned by the thirteenth parser.
 * @template TN The type of the value returned by the fourteenth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @template TStateK The type of the state used by the eleventh parser.
 * @template TStateL The type of the state used by the twelfth parser.
 * @template TStateM The type of the state used by the thirteenth parser.
 * @template TStateN The type of the state used by the fourteenth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @param k The eleventh {@link Parser} to try.
 * @param l The twelfth {@link Parser} to try.
 * @param m The thirteenth {@link Parser} to try.
 * @param n The fourteenth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 1.0.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  MK extends Mode,
  ML extends Mode,
  MM extends Mode,
  MN extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TK,
  TL,
  TM,
  TN,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
  TStateK,
  TStateL,
  TStateM,
  TStateN,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
  k: Parser<MK, TK, TStateK>,
  l: Parser<ML, TL, TStateL>,
  m: Parser<MM, TM, TStateM>,
  n: Parser<MN, TN, TStateN>,
): Parser<
  CombineModes<
    readonly [MA, MB, MC, MD, ME, MF, MG, MH, MI, MJ, MK, ML, MM, MN]
  >,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ | TK | TL | TM | TN,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
  | [10, ParserResult<TStateK>]
  | [11, ParserResult<TStateL>]
  | [12, ParserResult<TStateM>]
  | [13, ParserResult<TStateN>]
>;

/**
 * Creates a parser that combines fifteen mutually exclusive parsers into one.
 * The resulting parser will try each of the provided parsers in order,
 * and return the result of the first successful parser.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template MD The mode of the fourth parser.
 * @template ME The mode of the fifth parser.
 * @template MF The mode of the sixth parser.
 * @template MG The mode of the seventh parser.
 * @template MH The mode of the eighth parser.
 * @template MI The mode of the ninth parser.
 * @template MJ The mode of the tenth parser.
 * @template MK The mode of the eleventh parser.
 * @template ML The mode of the twelfth parser.
 * @template MM The mode of the thirteenth parser.
 * @template MN The mode of the fourteenth parser.
 * @template MO The mode of the fifteenth parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TD The type of the value returned by the fourth parser.
 * @template TE The type of the value returned by the fifth parser.
 * @template TF The type of the value returned by the sixth parser.
 * @template TG The type of the value returned by the seventh parser.
 * @template TH The type of the value returned by the eighth parser.
 * @template TI The type of the value returned by the ninth parser.
 * @template TJ The type of the value returned by the tenth parser.
 * @template TK The type of the value returned by the eleventh parser.
 * @template TL The type of the value returned by the twelfth parser.
 * @template TM The type of the value returned by the thirteenth parser.
 * @template TN The type of the value returned by the fourteenth parser.
 * @template TO The type of the value returned by the fifteenth parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @template TStateD The type of the state used by the fourth parser.
 * @template TStateE The type of the state used by the fifth parser.
 * @template TStateF The type of the state used by the sixth parser.
 * @template TStateG The type of the state used by the seventh parser.
 * @template TStateH The type of the state used by the eighth parser.
 * @template TStateI The type of the state used by the ninth parser.
 * @template TStateJ The type of the state used by the tenth parser.
 * @template TStateK The type of the state used by the eleventh parser.
 * @template TStateL The type of the state used by the twelfth parser.
 * @template TStateM The type of the state used by the thirteenth parser.
 * @template TStateN The type of the state used by the fourteenth parser.
 * @template TStateO The type of the state used by the fifteenth parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param d The fourth {@link Parser} to try.
 * @param e The fifth {@link Parser} to try.
 * @param f The sixth {@link Parser} to try.
 * @param g The seventh {@link Parser} to try.
 * @param h The eighth {@link Parser} to try.
 * @param i The ninth {@link Parser} to try.
 * @param j The tenth {@link Parser} to try.
 * @param k The eleventh {@link Parser} to try.
 * @param l The twelfth {@link Parser} to try.
 * @param m The thirteenth {@link Parser} to try.
 * @param n The fourteenth {@link Parser} to try.
 * @param o The fifteenth {@link Parser} to try.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @since 1.0.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  MD extends Mode,
  ME extends Mode,
  MF extends Mode,
  MG extends Mode,
  MH extends Mode,
  MI extends Mode,
  MJ extends Mode,
  MK extends Mode,
  ML extends Mode,
  MM extends Mode,
  MN extends Mode,
  MO extends Mode,
  TA,
  TB,
  TC,
  TD,
  TE,
  TF,
  TG,
  TH,
  TI,
  TJ,
  TK,
  TL,
  TM,
  TN,
  TO,
  TStateA,
  TStateB,
  TStateC,
  TStateD,
  TStateE,
  TStateF,
  TStateG,
  TStateH,
  TStateI,
  TStateJ,
  TStateK,
  TStateL,
  TStateM,
  TStateN,
  TStateO,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  d: Parser<MD, TD, TStateD>,
  e: Parser<ME, TE, TStateE>,
  f: Parser<MF, TF, TStateF>,
  g: Parser<MG, TG, TStateG>,
  h: Parser<MH, TH, TStateH>,
  i: Parser<MI, TI, TStateI>,
  j: Parser<MJ, TJ, TStateJ>,
  k: Parser<MK, TK, TStateK>,
  l: Parser<ML, TL, TStateL>,
  m: Parser<MM, TM, TStateM>,
  n: Parser<MN, TN, TStateN>,
  o: Parser<MO, TO, TStateO>,
): Parser<
  CombineModes<
    readonly [
      MA,
      MB,
      MC,
      MD,
      ME,
      MF,
      MG,
      MH,
      MI,
      MJ,
      MK,
      ML,
      MM,
      MN,
      MO,
    ]
  >,
  TA | TB | TC | TD | TE | TF | TG | TH | TI | TJ | TK | TL | TM | TN | TO,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
  | [3, ParserResult<TStateD>]
  | [4, ParserResult<TStateE>]
  | [5, ParserResult<TStateF>]
  | [6, ParserResult<TStateG>]
  | [7, ParserResult<TStateH>]
  | [8, ParserResult<TStateI>]
  | [9, ParserResult<TStateJ>]
  | [10, ParserResult<TStateK>]
  | [11, ParserResult<TStateL>]
  | [12, ParserResult<TStateM>]
  | [13, ParserResult<TStateN>]
  | [14, ParserResult<TStateO>]
>;

/**
 * Creates a parser that combines two mutually exclusive parsers into one,
 * with custom error message options.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param options Custom error message options.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.5.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  TA,
  TB,
  TStateA,
  TStateB,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  options: OrOptions,
): Parser<
  CombineModes<readonly [MA, MB]>,
  TA | TB,
  undefined | [0, ParserResult<TStateA>] | [1, ParserResult<TStateB>]
>;

/**
 * Creates a parser that combines three mutually exclusive parsers into one,
 * with custom error message options.
 * @template MA The mode of the first parser.
 * @template MB The mode of the second parser.
 * @template MC The mode of the third parser.
 * @template TA The type of the value returned by the first parser.
 * @template TB The type of the value returned by the second parser.
 * @template TC The type of the value returned by the third parser.
 * @template TStateA The type of the state used by the first parser.
 * @template TStateB The type of the state used by the second parser.
 * @template TStateC The type of the state used by the third parser.
 * @param a The first {@link Parser} to try.
 * @param b The second {@link Parser} to try.
 * @param c The third {@link Parser} to try.
 * @param options Custom error message options.
 * @return A {@link Parser} that tries to parse using the provided parsers
 *         in order, returning the result of the first successful parser.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.5.0
 */
export function or<
  MA extends Mode,
  MB extends Mode,
  MC extends Mode,
  TA,
  TB,
  TC,
  TStateA,
  TStateB,
  TStateC,
>(
  a: Parser<MA, TA, TStateA>,
  b: Parser<MB, TB, TStateB>,
  c: Parser<MC, TC, TStateC>,
  options: OrOptions,
): Parser<
  CombineModes<readonly [MA, MB, MC]>,
  TA | TB | TC,
  | undefined
  | [0, ParserResult<TStateA>]
  | [1, ParserResult<TStateB>]
  | [2, ParserResult<TStateC>]
>;

/**
 * Creates a parser that tries each parser in sequence until one succeeds,
 * with custom error message options.
 * @param rest Parsers to try, followed by {@link OrOptions} for error
 *             customization.
 * @returns A parser that succeeds if any of the input parsers succeed.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.5.0
 */
export function or<
  const TParsers extends readonly Parser<Mode, unknown, unknown>[],
>(
  ...rest:
    & [...parsers: TParsers, options: OrTailOptions]
    & OrArityGuard<TParsers>
): Parser<
  CombineModes<{ readonly [K in keyof TParsers]: ExtractMode<TParsers[K]> }>,
  InferValue<TParsers[number]>,
  undefined | [number, ParserResult<unknown>]
>;

/**
 * Creates a parser that tries each parser in sequence until one succeeds.
 * @param parsers Parsers to try in order.
 * @returns A parser that succeeds if any of the input parsers succeed.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.5.0
 */
export function or<
  const TParsers extends readonly Parser<Mode, unknown, unknown>[],
>(
  ...parsers: TParsers & OrArityGuard<TParsers>
): Parser<
  CombineModes<{ readonly [K in keyof TParsers]: ExtractMode<TParsers[K]> }>,
  InferValue<TParsers[number]>,
  undefined | [number, ParserResult<unknown>]
>;
/**
 * @since 0.5.0
 */
export function or(
  ...args: Array<Parser<Mode, unknown, unknown> | OrOptions>
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]> {
  // Extract parsers and options from arguments
  let parsers: Parser<Mode, unknown, unknown>[];
  let options: OrOptions | undefined;

  if (
    args.length > 0 && args[args.length - 1] &&
    typeof args[args.length - 1] === "object" &&
    !("$valueType" in args[args.length - 1])
  ) {
    // Last argument is options
    options = args[args.length - 1] as OrOptions;
    parsers = args.slice(0, -1) as Parser<Mode, unknown, unknown>[];
  } else {
    // No options provided
    parsers = args as Parser<Mode, unknown, unknown>[];
    options = undefined;
  }

  if (parsers.length < 1) {
    throw new TypeError("or() requires at least one parser argument.");
  }
  assertParsers(parsers, "or()");

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(parsers);

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];

  type OrState = undefined | [number, ParserResult<unknown>];
  type ParseResult = ParserResult<OrState>;

  const getInitialError = (
    context: ParserContext<OrState>,
  ): { consumed: number; error: Message } => ({
    consumed: 0,
    error: context.buffer.length < 1
      ? getNoMatchError(options, noMatchContext)
      : (() => {
        const token = context.buffer[0];
        const defaultMsg = message`Unexpected option or subcommand: ${
          eOptionName(token)
        }.`;

        // If custom error is provided, use it
        if (options?.errors?.unexpectedInput != null) {
          return typeof options.errors.unexpectedInput === "function"
            ? options.errors.unexpectedInput(token)
            : options.errors.unexpectedInput;
        }

        // Otherwise, add suggestions scoped to current parsers
        return createUnexpectedInputErrorWithScopedSuggestions(
          defaultMsg,
          token,
          parsers,
          options?.errors?.suggestions,
        );
      })(),
  });

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<OrState>,
  ): ParseResult => {
    let error = getInitialError(context);
    const activeState = normalizeExclusiveState(context.state);
    const orderedParsers = syncParsers.map((p, i) =>
      [p, i] as [Parser<"sync", unknown, unknown>, number]
    );
    orderedParsers.sort(([_, a], [__, b]) =>
      activeState?.[0] === a ? -1 : activeState?.[0] === b ? 1 : a - b
    );
    // Track zero-consuming successful branches as a fallback.
    // Only non-catch-all branches qualify (acceptingAnyToken excludes
    // tuple([argument(...)]) whose parse "success" on empty input is
    // incidental).  Accept the fallback only when exactly one qualifying
    // branch succeeded (unambiguous).
    let zeroConsumedBranch: {
      index: number;
      parser: Parser<"sync", unknown, unknown>;
      result: ParserResult<unknown> & { success: true };
    } | null = null;
    let zeroConsumedCount = 0;
    // Track provisional consuming results (e.g., from speculative branch
    // parsing in conditional()).  These are deferred so that a definitive
    // consuming branch can take priority.  When multiple provisional
    // branches match, discard all to stay order-independent.
    let provisionalConsuming: {
      index: number;
      parser: Parser<"sync", unknown, unknown>;
      result: ParserResult<unknown> & { success: true };
    } | null = null;
    let provisionalAmbiguous = false;
    for (const [parser, i] of orderedParsers) {
      const result = parser.parse(
        withChildContext(
          context,
          i,
          activeState == null || activeState[0] !== i ||
            !activeState[1].success
            ? parser.initialState
            : activeState[1].next.state,
          parser,
        ),
      );
      if (result.success && result.consumed.length > 0) {
        // Provisional consuming results are deferred: continue trying
        // other branches so a definitive result can take priority.
        // When multiple provisional branches match, discard all to
        // stay order-independent.
        if (result.provisional) {
          const activeBranchLocked = activeState != null &&
            activeState[1].success &&
            activeState[1].consumed.length > 0;
          // When the active branch yields a provisional result, it
          // takes precedence over competing provisionals: subsequent
          // hits from other branches should not displace it.  In
          // nested object()/merge() flows that revisit the same or()
          // state, this preserves the active selection across calls.
          if (activeBranchLocked && activeState[0] === i) {
            provisionalConsuming = { index: i, parser, result };
            continue;
          }
          // Once an active-branch provisional has been recorded, do
          // not let cross-branch provisionals overwrite it or trip
          // ambiguity tracking.
          if (
            activeBranchLocked &&
            provisionalConsuming != null &&
            provisionalConsuming.index === activeState[0]
          ) {
            continue;
          }
          if (provisionalConsuming == null && !provisionalAmbiguous) {
            provisionalConsuming = { index: i, parser, result };
          } else {
            provisionalConsuming = null;
            provisionalAmbiguous = true;
          }
          continue;
        }
        if (activeState?.[0] !== i && activeState?.[1].success) {
          // If the active branch consumed nothing (zero-consumed
          // fallback), allow the switch freely: no shared-options
          // conflict is possible and the empty consumed array would
          // crash values() in the error path.
          if (activeState[1].consumed.length === 0) {
            const mergedExec = mergeChildExec(
              context.exec,
              result.next.exec,
            );
            return {
              success: true,
              next: {
                ...context,
                buffer: result.next.buffer,
                optionsTerminated: result.next.optionsTerminated,
                state: createExclusiveState(
                  context.state,
                  i,
                  parser,
                  result,
                ),
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
          // Different branch succeeded. Check if the new branch can also
          // consume the previously consumed input (shared options case).
          const previouslyConsumed = activeState[1].consumed;
          const checkResult = parser.parse({
            ...withChildContext(context, i, parser.initialState, parser),
            buffer: previouslyConsumed,
          });
          // If the new branch can consume exactly the same input,
          // this is a shared option - allow branch switch.
          const canConsumeShared = checkResult.success &&
            checkResult.consumed.length === previouslyConsumed.length &&
            checkResult.consumed.every((c, idx) =>
              c === previouslyConsumed[idx]
            );
          if (!canConsumeShared) {
            return {
              success: false,
              consumed: context.buffer.length - result.next.buffer.length,
              error: message`${values(activeState[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
            };
          }
          // Branch switch allowed - re-parse current input with state from
          // shared options to ensure dependency values are available.
          const replayExec = mergeChildExec(
            context.exec,
            checkResult.next.exec,
          );
          const replayedResult = parser.parse(
            withChildContext(
              {
                ...context,
                ...(replayExec != null
                  ? {
                    exec: replayExec,
                    dependencyRegistry: replayExec.dependencyRegistry,
                  }
                  : {}),
              },
              i,
              checkResult.next.state,
              parser,
            ),
          );
          if (!replayedResult.success) {
            return replayedResult;
          }
          const mergedExec = mergeChildExec(
            replayExec,
            replayedResult.next.exec,
          );
          return {
            success: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: createExclusiveState(
                context.state,
                i,
                parser,
                {
                  ...replayedResult,
                  consumed: [
                    ...previouslyConsumed,
                    ...replayedResult.consumed,
                  ],
                },
              ),
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            },
            consumed: replayedResult.consumed,
          };
        }
        const mergedExec = mergeChildExec(context.exec, result.next.exec);
        return {
          success: true,
          next: {
            ...context,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: createExclusiveState(context.state, i, parser, result),
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: result.consumed,
        };
      } else if (
        result.success && result.consumed.length === 0 &&
        !result.provisional &&
        // Only branches that can never match input tokens qualify.
        parser.leadingNames.size === 0 && !parser.acceptingAnyToken
      ) {
        if (zeroConsumedBranch === null) {
          zeroConsumedBranch = { index: i, parser, result };
        }
        zeroConsumedCount++;
      } else if (!result.success && error.consumed < result.consumed) {
        error = result;
      }
    }
    // Accept non-consuming branch when unambiguous, no branch consumed
    // tokens before failing, and the buffer is empty.  When tokens remain,
    // accepting a zero-consumed fallback would leave them unconsumed,
    // causing the top-level parse loop to stall and emit a generic
    // "Unexpected option" error instead of the construct's own error.
    if (
      zeroConsumedBranch !== null && zeroConsumedCount === 1 &&
      error.consumed === 0 && context.buffer.length === 0
    ) {
      // Persist the branch state so wrappers like multiple() can
      // see the state change.  Only propagate provisional from the
      // selected branch — a definitively resolved branch (e.g.,
      // constant()) should not be marked provisional, so that
      // or(or(constant("inner")), constant("outer")) correctly
      // returns "inner".
      const mergedExec = mergeChildExec(
        context.exec,
        zeroConsumedBranch.result.next.exec,
      );
      return {
        success: true,
        ...(zeroConsumedBranch.result.provisional
          ? { provisional: true as const }
          : {}),
        next: {
          ...context,
          state: createExclusiveState(
            context.state,
            zeroConsumedBranch.index,
            zeroConsumedBranch.parser,
            zeroConsumedBranch.result,
          ),
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: [],
      };
    }
    // Fall back to a provisional consuming result when no definitive
    // branch consumed tokens.  This lets speculative results from
    // conditional() take effect only when no better alternative exists.
    if (provisionalConsuming !== null) {
      const activeIsLockedDifferent = activeState != null &&
        activeState[1].success &&
        activeState[1].consumed.length > 0 &&
        activeState[0] !== provisionalConsuming.index;
      if (!activeIsLockedDifferent) {
        const mergedExec = mergeChildExec(
          context.exec,
          provisionalConsuming.result.next.exec,
        );
        return {
          success: true,
          provisional: true,
          next: {
            ...context,
            buffer: provisionalConsuming.result.next.buffer,
            optionsTerminated:
              provisionalConsuming.result.next.optionsTerminated,
            state: createExclusiveState(
              context.state,
              provisionalConsuming.index,
              provisionalConsuming.parser,
              provisionalConsuming.result,
            ),
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: provisionalConsuming.result.consumed,
        };
      }
      // The provisional comes from a different branch than the
      // active one.  Mirror the definitive branch-switch path:
      // attempt a shared-option replay and, if the provisional
      // branch can also consume the previously consumed tokens,
      // commit to it after replaying.
      if (activeState != null && activeState[1].success) {
        const previouslyConsumed = activeState[1].consumed;
        const checkResult = provisionalConsuming.parser.parse({
          ...withChildContext(
            context,
            provisionalConsuming.index,
            provisionalConsuming.parser.initialState,
            provisionalConsuming.parser,
          ),
          buffer: previouslyConsumed,
        });
        const canConsumeShared = checkResult.success &&
          checkResult.consumed.length === previouslyConsumed.length &&
          checkResult.consumed.every((c, idx) => c === previouslyConsumed[idx]);
        if (canConsumeShared && checkResult.success) {
          const replayExec = mergeChildExec(
            context.exec,
            checkResult.next.exec,
          );
          const replayedResult = provisionalConsuming.parser.parse(
            withChildContext(
              {
                ...context,
                ...(replayExec != null
                  ? {
                    exec: replayExec,
                    dependencyRegistry: replayExec.dependencyRegistry,
                  }
                  : {}),
              },
              provisionalConsuming.index,
              checkResult.next.state,
              provisionalConsuming.parser,
            ),
          );
          // Mirror the definitive branch-switch path: when the replay
          // fails, propagate that failure so outer combinators see the
          // real consumed depth and error instead of falling back to
          // the earlier branch-loop error.
          if (!replayedResult.success) {
            return replayedResult;
          }
          const mergedExec = mergeChildExec(
            replayExec,
            replayedResult.next.exec,
          );
          return {
            success: true,
            provisional: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: createExclusiveState(
                context.state,
                provisionalConsuming.index,
                provisionalConsuming.parser,
                {
                  ...replayedResult,
                  // Force `provisional: true` on the stored result so
                  // subsequent or() parse calls keep treating this branch
                  // as a tentative selection.  Without this, a replay
                  // that returns a non-provisional success (e.g., a child
                  // parser that didn't propagate provisional itself)
                  // would clear the flag in state, and outer combinators
                  // would treat the branch as definitive — blocking the
                  // intended fallthrough to definitive alternatives.
                  provisional: true as const,
                  consumed: [
                    ...previouslyConsumed,
                    ...replayedResult.consumed,
                  ],
                },
              ),
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            },
            consumed: replayedResult.consumed,
          };
        }
      }
    }
    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<OrState>,
  ): Promise<ParseResult> => {
    let error = getInitialError(context);
    const activeState = normalizeExclusiveState(context.state);
    const orderedParsers = parsers.map((p, i) =>
      [p, i] as [Parser<Mode, unknown, unknown>, number]
    );
    orderedParsers.sort(([_, a], [__, b]) =>
      activeState?.[0] === a ? -1 : activeState?.[0] === b ? 1 : a - b
    );
    // Track zero-consuming successful branches (see sync counterpart).
    let zeroConsumedBranch: {
      index: number;
      parser: Parser<Mode, unknown, unknown>;
      result: ParserResult<unknown> & { success: true };
    } | null = null;
    let zeroConsumedCount = 0;
    // Track provisional consuming results (see sync counterpart).
    let provisionalConsuming: {
      index: number;
      parser: Parser<Mode, unknown, unknown>;
      result: ParserResult<unknown> & { success: true };
    } | null = null;
    let provisionalAmbiguous = false;
    for (const [parser, i] of orderedParsers) {
      const resultOrPromise = parser.parse(
        withChildContext(
          context,
          i,
          activeState == null || activeState[0] !== i ||
            !activeState[1].success
            ? parser.initialState
            : activeState[1].next.state,
          parser,
        ),
      );
      const result = await resultOrPromise;
      if (result.success && result.consumed.length > 0) {
        // Provisional consuming results are deferred (see sync counterpart).
        if (result.provisional) {
          const activeBranchLocked = activeState != null &&
            activeState[1].success &&
            activeState[1].consumed.length > 0;
          // Active-branch provisionals win over competing provisionals
          // (see sync counterpart).
          if (activeBranchLocked && activeState[0] === i) {
            provisionalConsuming = { index: i, parser, result };
            continue;
          }
          if (
            activeBranchLocked &&
            provisionalConsuming != null &&
            provisionalConsuming.index === activeState[0]
          ) {
            continue;
          }
          if (provisionalConsuming == null && !provisionalAmbiguous) {
            provisionalConsuming = { index: i, parser, result };
          } else {
            provisionalConsuming = null;
            provisionalAmbiguous = true;
          }
          continue;
        }
        if (activeState?.[0] !== i && activeState?.[1].success) {
          // If the active branch consumed nothing (zero-consumed
          // fallback), allow the switch freely (see sync counterpart).
          if (activeState[1].consumed.length === 0) {
            const mergedExec = mergeChildExec(
              context.exec,
              result.next.exec,
            );
            return {
              success: true,
              next: {
                ...context,
                buffer: result.next.buffer,
                optionsTerminated: result.next.optionsTerminated,
                state: createExclusiveState(
                  context.state,
                  i,
                  parser,
                  result,
                ),
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
          // Different branch succeeded. Check if the new branch can also
          // consume the previously consumed input (shared options case).
          const previouslyConsumed = activeState[1].consumed;
          const checkResultOrPromise = parser.parse({
            ...withChildContext(context, i, parser.initialState, parser),
            buffer: previouslyConsumed,
          });
          const checkResult = await checkResultOrPromise;
          // If the new branch can consume exactly the same input,
          // this is a shared option - allow branch switch.
          const canConsumeShared = checkResult.success &&
            checkResult.consumed.length === previouslyConsumed.length &&
            checkResult.consumed.every((c, idx) =>
              c === previouslyConsumed[idx]
            );
          if (!canConsumeShared) {
            return {
              success: false,
              consumed: context.buffer.length - result.next.buffer.length,
              error: message`${values(activeState[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
            };
          }
          // Branch switch allowed - re-parse current input with state from
          // shared options to ensure dependency values are available.
          const replayExec = mergeChildExec(
            context.exec,
            checkResult.next.exec,
          );
          const replayedResultOrPromise = parser.parse(
            withChildContext(
              {
                ...context,
                ...(replayExec != null
                  ? {
                    exec: replayExec,
                    dependencyRegistry: replayExec.dependencyRegistry,
                  }
                  : {}),
              },
              i,
              checkResult.next.state,
              parser,
            ),
          );
          const replayedResult = await replayedResultOrPromise;
          if (!replayedResult.success) {
            return replayedResult;
          }
          const mergedExec = mergeChildExec(
            replayExec,
            replayedResult.next.exec,
          );
          return {
            success: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: createExclusiveState(
                context.state,
                i,
                parser,
                {
                  ...replayedResult,
                  consumed: [
                    ...previouslyConsumed,
                    ...replayedResult.consumed,
                  ],
                },
              ),
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            },
            consumed: replayedResult.consumed,
          };
        }
        const mergedExec = mergeChildExec(context.exec, result.next.exec);
        return {
          success: true,
          next: {
            ...context,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: createExclusiveState(context.state, i, parser, result),
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: result.consumed,
        };
      } else if (
        result.success && result.consumed.length === 0 &&
        !result.provisional &&
        // Only branches with no leading names qualify (see sync).
        parser.leadingNames.size === 0 && !parser.acceptingAnyToken
      ) {
        if (zeroConsumedBranch === null) {
          zeroConsumedBranch = { index: i, parser, result };
        }
        zeroConsumedCount++;
      } else if (!result.success && error.consumed < result.consumed) {
        error = result;
      }
    }
    // Accept non-consuming branch when unambiguous (see sync counterpart).
    if (
      zeroConsumedBranch !== null && zeroConsumedCount === 1 &&
      error.consumed === 0 && context.buffer.length === 0
    ) {
      // Persist branch state (see sync counterpart for rationale).
      const mergedExec = mergeChildExec(
        context.exec,
        zeroConsumedBranch.result.next.exec,
      );
      return {
        success: true,
        ...(zeroConsumedBranch.result.provisional
          ? { provisional: true as const }
          : {}),
        next: {
          ...context,
          state: createExclusiveState(
            context.state,
            zeroConsumedBranch.index,
            zeroConsumedBranch.parser,
            zeroConsumedBranch.result,
          ),
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: [],
      };
    }
    // Fall back to provisional consuming result (see sync counterpart).
    if (provisionalConsuming !== null) {
      const activeIsLockedDifferent = activeState != null &&
        activeState[1].success &&
        activeState[1].consumed.length > 0 &&
        activeState[0] !== provisionalConsuming.index;
      if (!activeIsLockedDifferent) {
        const mergedExec = mergeChildExec(
          context.exec,
          provisionalConsuming.result.next.exec,
        );
        return {
          success: true,
          provisional: true,
          next: {
            ...context,
            buffer: provisionalConsuming.result.next.buffer,
            optionsTerminated:
              provisionalConsuming.result.next.optionsTerminated,
            state: createExclusiveState(
              context.state,
              provisionalConsuming.index,
              provisionalConsuming.parser,
              provisionalConsuming.result,
            ),
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: provisionalConsuming.result.consumed,
        };
      }
      // Cross-branch provisional vs active locked branch: try a
      // shared-option replay (mirrors the definitive branch path).
      // The activeIsLockedDifferent check above already ensures
      // activeState[1].success, but TypeScript can't carry that
      // narrowing here, so re-test inline.
      if (activeState != null && activeState[1].success) {
        const previouslyConsumed = activeState[1].consumed;
        const checkResult = await provisionalConsuming.parser.parse({
          ...withChildContext(
            context,
            provisionalConsuming.index,
            provisionalConsuming.parser.initialState,
            provisionalConsuming.parser,
          ),
          buffer: previouslyConsumed,
        });
        const canConsumeShared = checkResult.success &&
          checkResult.consumed.length === previouslyConsumed.length &&
          checkResult.consumed.every((c, idx) => c === previouslyConsumed[idx]);
        if (canConsumeShared && checkResult.success) {
          const replayExec = mergeChildExec(
            context.exec,
            checkResult.next.exec,
          );
          const replayedResult = await provisionalConsuming.parser.parse(
            withChildContext(
              {
                ...context,
                ...(replayExec != null
                  ? {
                    exec: replayExec,
                    dependencyRegistry: replayExec.dependencyRegistry,
                  }
                  : {}),
              },
              provisionalConsuming.index,
              checkResult.next.state,
              provisionalConsuming.parser,
            ),
          );
          // See the sync counterpart for rationale.
          if (!replayedResult.success) {
            return replayedResult;
          }
          const mergedExec = mergeChildExec(
            replayExec,
            replayedResult.next.exec,
          );
          return {
            success: true,
            provisional: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: createExclusiveState(
                context.state,
                provisionalConsuming.index,
                provisionalConsuming.parser,
                {
                  ...replayedResult,
                  // Force `provisional: true` (see sync counterpart).
                  provisional: true as const,
                  consumed: [
                    ...previouslyConsumed,
                    ...replayedResult.consumed,
                  ],
                },
              ),
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            },
            consumed: replayedResult.consumed,
          };
        }
      }
    }
    return { ...error, success: false };
  };

  const singleResult = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    leadingNames: unionLeadingNames(parsers),
    acceptingAnyToken: parsers.some((p) => p.acceptingAnyToken),
    initialState: undefined,
    complete: createExclusiveComplete(
      parsers,
      options,
      noMatchContext,
      combinedMode,
    ),
    [extractPhase2SeedKey](state: OrState, exec?: ExecutionContext) {
      return extractExclusivePhase2Seed(parsers, state, exec, combinedMode);
    },
    parse(context: ParserContext<OrState>) {
      return dispatchByMode(
        combinedMode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    getSuggestRuntimeNodes(
      state: undefined | [number, ParserResult<unknown>],
      path: readonly PropertyKey[],
    ) {
      return getExclusiveSuggestRuntimeNodes(parsers, state, path);
    },
    suggest: createExclusiveSuggest(parsers, combinedMode),
    getDocFragments(
      state: DocState<undefined | [number, ParserResult<unknown>]>,
      _defaultValue?: unknown,
    ) {
      let brief: Message | undefined;
      let description: Message | undefined;
      let footer: Message | undefined;
      let fragments: readonly DocFragment[];

      if (state.kind === "unavailable" || state.state == null) {
        // When state is unavailable or null, show all parser options
        fragments = parsers.flatMap((p) =>
          p.getDocFragments({ kind: "unavailable" }, undefined).fragments
        );
      } else {
        // When state is available and has a value, show only the selected parser
        const [index, parserResult] = state.state;
        const innerState: DocState<unknown> = parserResult.success
          ? { kind: "available", state: parserResult.next.state }
          : { kind: "unavailable" };
        const docFragments = parsers[index].getDocFragments(
          innerState,
          undefined,
        );
        brief = docFragments.brief;
        description = docFragments.description;
        footer = docFragments.footer;
        fragments = docFragments.fragments;
      }
      // When a single branch matched successfully, pass its fragments
      // Only deduplicate when showing all branches.  When state.state is
      // set, fragments come from a single branch (whether successful or
      // failed), so cross-branch dedup does not apply and would collapse
      // intentional duplicates (e.g., allowDuplicates).
      if (state.kind === "unavailable" || state.state == null) {
        fragments = deduplicateDocFragments(fragments);
      }
      return {
        brief,
        description,
        footer,
        fragments,
      };
    },
  };
  const singleDependencyMetadata = composeExclusiveDependencyMetadata(parsers);
  if (singleDependencyMetadata != null) {
    (singleResult as Record<string, unknown>).dependencyMetadata =
      singleDependencyMetadata;
  }
  defineInheritedAnnotationParser(singleResult);

  // or() does NOT forward normalizeValue because the active branch is
  // unknown at default time — normalizing through the wrong branch would
  // produce values that differ from what parse() returns.  The same
  // reasoning applies to validateValue (#414): a fallback value may
  // belong to any branch, so revalidating through a single arbitrary
  // branch would reject values that another branch would accept.
  return singleResult as Parser<
    Mode,
    unknown,
    [number, ParserResult<unknown>] | undefined
  >;
}

/**
 * Options for customizing error messages in the {@link longestMatch}
 * combinator.
 * @since 0.5.0
 */
export interface LongestMatchOptions {
  /**
   * Error message customization options.
   */
  errors?: LongestMatchErrorOptions;
}

/**
 * Options for customizing error messages in the {@link longestMatch} parser.
 * @since 0.5.0
 */
export interface LongestMatchErrorOptions {
  /**
   * Custom error message when no parser matches.
   * Can be a static message or a function that receives context about what
   * types of inputs are expected, allowing for more precise error messages.
   *
   * @example
   * ```typescript
   * // Static message (overrides all cases)
   * { noMatch: message`Invalid input.` }
   *
   * // Dynamic message based on context (for i18n, etc.)
   * {
   *   noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
   *     if (hasArguments && !hasOptions && !hasCommands) {
   *       return message`引数が必要です。`; // Japanese: "Argument required"
   *     }
   *     // ... other cases
   *   }
   * }
   * ```
   * @since 0.9.0 - Function form added
   */
  noMatch?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom error message for unexpected input.
   * Can be a static message or a function that receives the unexpected token.
   */
  unexpectedInput?: Message | ((token: string) => Message);

  /**
   * Custom function to format suggestion messages.
   * If provided, this will be used instead of the default "Did you mean?"
   * formatting. The function receives an array of similar valid options/commands
   * and should return a formatted message to append to the error.
   *
   * @param suggestions Array of similar valid option/command names
   * @returns Formatted message to append to the error (can be empty array for no suggestions)
   * @since 0.7.0
   */
  suggestions?: (suggestions: readonly string[]) => Message;
}

type LongestMatchParserArity =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;
type LongestMatchArityLimitError = {
  readonly __optiqueLongestMatchArityLimit:
    "longestMatch() requires between 1 and 15 parser arguments. Nest longestMatch() to combine more.";
};
type LongestMatchTailOptions = LongestMatchOptions & {
  readonly $valueType?: never;
};
type TupleKeys<T extends readonly unknown[]> = Exclude<
  keyof T,
  keyof readonly unknown[]
>;
type LongestMatchTupleState<
  TParsers extends readonly Parser<Mode, unknown, unknown>[],
> = {
  [K in TupleKeys<TParsers>]: TParsers[K] extends Parser<
    Mode,
    unknown,
    infer TState
  >
    ? K extends `${infer TIndex extends number}`
      ? [TIndex, ParserResult<TState>]
    : never
    : never;
}[TupleKeys<TParsers>];
type LongestMatchState<
  TParsers extends readonly Parser<Mode, unknown, unknown>[],
> = IsTuple<TParsers> extends true
  ? undefined | LongestMatchTupleState<TParsers>
  : undefined | [number, ParserResult<unknown>];
type LongestMatchArityGuard<TParsers extends readonly unknown[]> =
  IsTuple<TParsers> extends true
    ? TParsers["length"] extends LongestMatchParserArity ? unknown
    : LongestMatchArityLimitError
    : unknown;

/**
 * Creates a parser that selects the successful branch that consumed
 * the most input tokens.
 *
 * The resulting parser tries every given parser and returns the
 * successful result that consumed more input than the others.
 *
 * @param parsers Parsers to evaluate and compare by consumed input.
 * @returns A parser that yields the best successful branch result.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @since 0.3.0
 */
export function longestMatch<
  const TParsers extends readonly Parser<"sync", unknown, unknown>[],
>(
  ...parsers: TParsers & LongestMatchArityGuard<TParsers>
): Parser<
  "sync",
  InferValue<TParsers[number]>,
  LongestMatchState<TParsers>
>;

/**
 * Creates a parser that selects the successful branch that consumed
 * the most input tokens, with custom error options.
 *
 * The resulting parser tries every given parser and returns the
 * successful result that consumed more input than the others.
 *
 * @param rest Parsers to compare, followed by error customization options.
 * @returns A parser that yields the best successful branch result.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.5.0
 */
export function longestMatch<
  const TParsers extends readonly Parser<"sync", unknown, unknown>[],
>(
  ...rest:
    & [...parsers: TParsers, options: LongestMatchTailOptions]
    & LongestMatchArityGuard<TParsers>
): Parser<
  "sync",
  InferValue<TParsers[number]>,
  LongestMatchState<TParsers>
>;

/**
 * Creates a parser that selects the successful branch that consumed
 * the most input tokens, with custom error options.
 *
 * @param rest Parsers to compare, followed by error customization options.
 * @returns A parser that yields the best successful branch result.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.5.0
 */
export function longestMatch<
  const TParsers extends readonly Parser<Mode, unknown, unknown>[],
>(
  ...rest:
    & [...parsers: TParsers, options: LongestMatchTailOptions]
    & LongestMatchArityGuard<TParsers>
): Parser<
  CombineModes<{ readonly [K in keyof TParsers]: ExtractMode<TParsers[K]> }>,
  InferValue<TParsers[number]>,
  LongestMatchState<TParsers>
>;

/**
 * Creates a parser that selects the successful branch that consumed
 * the most input tokens.
 *
 * The resulting parser tries every given parser and returns the
 * successful result that consumed more input than the others.
 *
 * @param parsers Parsers to evaluate and compare by consumed input.
 * @returns A parser that yields the best successful branch result.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @since 0.3.0
 */
export function longestMatch<
  const TParsers extends readonly Parser<Mode, unknown, unknown>[],
>(
  ...parsers: TParsers & LongestMatchArityGuard<TParsers>
): Parser<
  CombineModes<{ readonly [K in keyof TParsers]: ExtractMode<TParsers[K]> }>,
  InferValue<TParsers[number]>,
  LongestMatchState<TParsers>
>;

/**
 * Creates a parser that selects the successful branch that consumed
 * the most input tokens from a homogeneous parser list.
 *
 * This overload is intended for spread arrays whose element types are
 * homogeneous enough that callers only need the shared value type.
 *
 * @param parsers Parsers to evaluate and compare by consumed input.
 * @returns A parser that preserves the shared parser mode and value type.
 * @since 1.0.0
 */
export function longestMatch<
  M extends Mode,
  TValue,
  TState,
  const TParsers extends readonly Parser<M, TValue, TState>[],
>(
  ...parsers: TParsers & LongestMatchArityGuard<TParsers>
): Parser<M, TValue, unknown>;

/**
 * Creates a parser that selects the successful branch that consumed
 * the most input tokens from a homogeneous parser list, with custom
 * error options.
 *
 * @param rest Parsers to compare, followed by error customization options.
 * @returns A parser that preserves the shared parser mode and value type.
 * @since 1.0.0
 */
export function longestMatch<
  M extends Mode,
  TValue,
  TState,
  const TParsers extends readonly Parser<M, TValue, TState>[],
>(
  ...rest:
    & [...parsers: TParsers, options: LongestMatchTailOptions]
    & LongestMatchArityGuard<TParsers>
): Parser<M, TValue, unknown>;
/**
 * @since 0.5.0
 */
export function longestMatch(
  ...args: Array<Parser<Mode, unknown, unknown> | LongestMatchOptions>
): Parser<Mode, unknown, undefined | [number, ParserResult<unknown>]> {
  // Extract parsers and options from arguments
  let parsers: Parser<Mode, unknown, unknown>[];
  let options: LongestMatchOptions | undefined;

  if (
    args.length > 0 && args[args.length - 1] &&
    typeof args[args.length - 1] === "object" &&
    !("$valueType" in args[args.length - 1])
  ) {
    // Last argument is options
    options = args[args.length - 1] as LongestMatchOptions;
    parsers = args.slice(0, -1) as Parser<Mode, unknown, unknown>[];
  } else {
    // No options provided
    parsers = args as Parser<Mode, unknown, unknown>[];
    options = undefined;
  }

  if (parsers.length < 1) {
    throw new TypeError(
      "longestMatch() requires at least one parser argument.",
    );
  }
  assertParsers(parsers, "longestMatch()");

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(parsers);

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", unknown, unknown>[];

  type LongestMatchState = undefined | [number, ParserResult<unknown>];
  type ParseResult = ParserResult<LongestMatchState>;

  const getInitialError = (
    context: ParserContext<LongestMatchState>,
  ): { consumed: number; error: Message } => ({
    consumed: 0,
    error: context.buffer.length < 1
      ? getNoMatchError(options, noMatchContext)
      : (() => {
        const token = context.buffer[0];
        const defaultMsg = message`Unexpected option or subcommand: ${
          eOptionName(token)
        }.`;

        // If custom error is provided, use it
        if (options?.errors?.unexpectedInput != null) {
          return typeof options.errors.unexpectedInput === "function"
            ? options.errors.unexpectedInput(token)
            : options.errors.unexpectedInput;
        }

        // Otherwise, add suggestions scoped to current parsers
        return createUnexpectedInputErrorWithScopedSuggestions(
          defaultMsg,
          token,
          parsers,
          options?.errors?.suggestions,
        );
      })(),
  });

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<LongestMatchState>,
  ): ParseResult => {
    let bestMatch: {
      index: number;
      parser: Parser<"sync", unknown, unknown>;
      result: ParserResult<unknown>;
      consumed: number;
    } | null = null;
    let error = getInitialError(context);
    const activeState = normalizeExclusiveState(context.state);

    // Try all parsers and find the one with longest match
    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const result = parser.parse(
        withChildContext(
          context,
          i,
          activeState == null || activeState[0] !== i ||
            !activeState[1].success
            ? parser.initialState
            : activeState[1].next.state,
          parser,
        ),
      );

      if (result.success) {
        const consumed = context.buffer.length - result.next.buffer.length;
        // Prefer non-provisional results over provisional ones at the
        // same consumed length, so speculative conditional() branches
        // don't shadow definitive matches at equal length.
        const bestIsProvisional = bestMatch != null &&
          bestMatch.result.success && !!bestMatch.result.provisional;
        if (
          bestMatch === null || consumed > bestMatch.consumed ||
          (consumed === bestMatch.consumed &&
            bestIsProvisional && !result.provisional)
        ) {
          bestMatch = { index: i, parser, result, consumed };
        }
      } else if (error.consumed < result.consumed) {
        error = result;
      }
    }

    if (bestMatch && bestMatch.result.success) {
      const mergedExec = mergeChildExec(
        context.exec,
        bestMatch.result.next.exec,
      );
      return {
        success: true,
        next: {
          ...context,
          buffer: bestMatch.result.next.buffer,
          optionsTerminated: bestMatch.result.next.optionsTerminated,
          state: createExclusiveState(
            context.state,
            bestMatch.index,
            bestMatch.parser,
            bestMatch.result,
          ),
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: bestMatch.result.consumed,
      };
    }

    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<LongestMatchState>,
  ): Promise<ParseResult> => {
    let bestMatch: {
      index: number;
      parser: Parser<Mode, unknown, unknown>;
      result: ParserResult<unknown>;
      consumed: number;
    } | null = null;
    let error = getInitialError(context);
    const activeState = normalizeExclusiveState(context.state);

    // Try all parsers and find the one with longest match
    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const resultOrPromise = parser.parse(
        withChildContext(
          context,
          i,
          activeState == null || activeState[0] !== i ||
            !activeState[1].success
            ? parser.initialState
            : activeState[1].next.state,
          parser,
        ),
      );
      const result = await resultOrPromise;

      if (result.success) {
        const consumed = context.buffer.length - result.next.buffer.length;
        // Prefer non-provisional results over provisional ones at the
        // same consumed length, so speculative conditional() branches
        // don't shadow definitive matches at equal length.
        const bestIsProvisional = bestMatch != null &&
          bestMatch.result.success && !!bestMatch.result.provisional;
        if (
          bestMatch === null || consumed > bestMatch.consumed ||
          (consumed === bestMatch.consumed &&
            bestIsProvisional && !result.provisional)
        ) {
          bestMatch = { index: i, parser, result, consumed };
        }
      } else if (error.consumed < result.consumed) {
        error = result;
      }
    }

    if (bestMatch && bestMatch.result.success) {
      const mergedExec = mergeChildExec(
        context.exec,
        bestMatch.result.next.exec,
      );
      return {
        success: true,
        next: {
          ...context,
          buffer: bestMatch.result.next.buffer,
          optionsTerminated: bestMatch.result.next.optionsTerminated,
          state: createExclusiveState(
            context.state,
            bestMatch.index,
            bestMatch.parser,
            bestMatch.result,
          ),
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        },
        consumed: bestMatch.result.consumed,
      };
    }

    return { ...error, success: false };
  };

  const multiResult = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: [{ type: "exclusive", terms: parsers.map((p) => p.usage) }],
    leadingNames: unionLeadingNames(parsers),
    acceptingAnyToken: parsers.some((p) => p.acceptingAnyToken),
    initialState: undefined,
    complete: createExclusiveComplete(
      parsers,
      options,
      noMatchContext,
      combinedMode,
    ),
    [extractPhase2SeedKey](state: LongestMatchState, exec?: ExecutionContext) {
      return extractExclusivePhase2Seed(parsers, state, exec, combinedMode);
    },
    parse(context: ParserContext<LongestMatchState>) {
      return dispatchByMode(
        combinedMode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    getSuggestRuntimeNodes(
      state: undefined | [number, ParserResult<unknown>],
      path: readonly PropertyKey[],
    ) {
      return getExclusiveSuggestRuntimeNodes(parsers, state, path);
    },
    suggest: createExclusiveSuggest(parsers, combinedMode),
    getDocFragments(
      state: DocState<undefined | [number, ParserResult<unknown>]>,
      _defaultValue?: unknown,
    ) {
      let brief: Message | undefined;
      let description: Message | undefined;
      let footer: Message | undefined;
      let fragments: readonly DocFragment[];

      let shouldDeduplicate: boolean;
      if (state.kind === "unavailable" || state.state == null) {
        // When state is unavailable or null, show all parser options
        fragments = parsers.flatMap((p) =>
          p.getDocFragments({ kind: "unavailable" }).fragments
        );
        shouldDeduplicate = true;
      } else {
        const [i, result] = state.state;
        if (result.success) {
          const docResult = parsers[i].getDocFragments(
            { kind: "available", state: result.next.state },
          );
          brief = docResult.brief;
          description = docResult.description;
          footer = docResult.footer;
          fragments = docResult.fragments;
          shouldDeduplicate = false;
        } else {
          fragments = parsers.flatMap((p) =>
            p.getDocFragments({ kind: "unavailable" }).fragments
          );
          shouldDeduplicate = true;
        }
      }

      return {
        brief,
        description,
        fragments: shouldDeduplicate
          ? deduplicateDocFragments(fragments)
          : fragments,
        footer,
      };
    },
  };
  const multiDependencyMetadata = composeExclusiveDependencyMetadata(parsers);
  if (multiDependencyMetadata != null) {
    (multiResult as Record<string, unknown>).dependencyMetadata =
      multiDependencyMetadata;
  }
  defineInheritedAnnotationParser(multiResult);

  // longestMatch() does NOT forward normalizeValue because the winning
  // branch is unknown at default time — normalizing through the wrong
  // branch would produce values that differ from what parse() returns.
  // The same reasoning applies to validateValue (#414).
  return multiResult as Parser<
    Mode,
    unknown,
    [number, ParserResult<unknown>] | undefined
  >;
}

/**
 * Options for the {@link object} parser.
 * @since 0.5.0
 */
export interface ObjectOptions {
  /**
   * Error messages customization.
   */
  readonly errors?: ObjectErrorOptions;

  /**
   * When `true`, allows duplicate option names across different fields.
   * By default (`false`), duplicate option names will cause a parse error.
   *
   * @default `false`
   * @since 0.7.0
   */
  readonly allowDuplicates?: boolean;

  /**
   * Controls visibility of all terms emitted by this object parser.
   * @since 1.0.0
   */
  readonly hidden?: HiddenVisibility;
}

/**
 * Options for customizing error messages in the {@link object} parser.
 * @since 0.5.0
 */
export interface ObjectErrorOptions {
  /**
   * Error message when an unexpected option or argument is encountered.
   */
  readonly unexpectedInput?: Message | ((token: string) => Message);

  /**
   * Error message when end of input is reached unexpectedly.
   * Can be a static message or a function that receives context about what
   * types of inputs are expected, allowing for more precise error messages.
   *
   * @example
   * ```typescript
   * // Static message (overrides all cases)
   * { endOfInput: message`Invalid input.` }
   *
   * // Dynamic message based on context (for i18n, etc.)
   * {
   *   endOfInput: ({ hasOptions, hasCommands, hasArguments }) => {
   *     if (hasArguments && !hasOptions && !hasCommands) {
   *       return message`Argument manquant.`; // French: "Missing argument"
   *     }
   *     // ... other cases
   *   }
   * }
   * ```
   * @since 0.9.0 - Function form added
   */
  readonly endOfInput?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom function to format suggestion messages.
   * If provided, this will be used instead of the default "Did you mean?"
   * formatting. The function receives an array of similar valid options/commands
   * and should return a formatted message to append to the error.
   *
   * @param suggestions Array of similar valid option/command names
   * @returns Formatted message to append to the error (can be empty array for no suggestions)
   * @since 0.7.0
   */
  readonly suggestions?: (suggestions: readonly string[]) => Message;
}

/**
 * Internal sync helper for object suggest functionality.
 * @internal
 */
function* suggestObjectSync<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  prefix: string,
  parserPairs: [string | symbol, Parser<"sync", unknown, unknown>][],
): Generator<Suggestion> {
  // Build dependency runtime and populate registry via metadata.
  const runtime = createDependencyRuntimeContext(
    context.dependencyRegistry?.clone(),
  );
  const sourceParserPairs = filterExcludedFieldParsers(
    parserPairs,
    context.exec?.excludedSourceFields,
  );
  const nodes = buildRuntimeNodesFromPairs(
    sourceParserPairs as readonly (readonly [
      PropertyKey,
      Parser<Mode, unknown, unknown>,
    ])[],
    (context.state && typeof context.state === "object"
      ? context.state
      : {}) as Record<PropertyKey, unknown>,
    context.exec?.path,
  );
  collectExplicitSourceValues(nodes, runtime);

  // Collect dependency sources from the state tree (handles nested
  // DependencySourceState inside arrays, e.g., multiple()).
  if (context.state && typeof context.state === "object") {
    collectSourcesFromState(
      context.state,
      runtime,
      new WeakSet<object>(),
      context.exec?.excludedSourceFields,
    );
  }

  // Pre-complete dependency source defaults (old-protocol bridge).
  // This is the single evaluation point for lazy defaults in the
  // suggest path — do NOT also call fillMissingSourceDefaults which
  // would evaluate the same defaults a second time.
  completeDependencySourceDefaults(
    context,
    sourceParserPairs,
    runtime.registry,
    context.exec,
  );

  // Expose the populated registry for child parsers' suggest() calls.
  const contextWithRegistry = {
    ...context,
    dependencyRegistry: runtime.registry,
    ...(context.exec != null
      ? {
        exec: {
          ...context.exec,
          dependencyRuntime: runtime,
          dependencyRegistry: runtime.registry,
        },
      }
      : {}),
  };

  // Check if the last token in the buffer is an option that requires a value.
  // If so, only suggest values for that specific option parser, not all parsers.
  // This prevents positional argument suggestions from appearing when completing
  // an option value. See: https://github.com/dahlia/optique/issues/55
  if (context.buffer.length > 0) {
    const lastToken = context.buffer[context.buffer.length - 1];

    // Find if any parser has this token as an option requiring a value
    for (const [field, parser] of parserPairs) {
      if (isOptionRequiringValue(parser.usage, lastToken)) {
        // Only get suggestions from the parser that owns this option
        const annotatedFieldState = getAnnotatedFieldState(
          context.state,
          field,
          parser,
        );

        yield* parser.suggest(
          withChildContext(
            contextWithRegistry,
            field,
            annotatedFieldState,
            parser,
          ),
          prefix,
        );
        return;
      }
    }
  }

  // Default behavior: try getting suggestions from each parser
  const suggestions: Suggestion[] = [];
  for (const [field, parser] of parserPairs) {
    const annotatedFieldState = getAnnotatedFieldState(
      context.state,
      field,
      parser,
    );

    const fieldSuggestions = parser.suggest(
      withChildContext(
        contextWithRegistry,
        field,
        annotatedFieldState,
        parser,
      ),
      prefix,
    );

    suggestions.push(...fieldSuggestions);
  }

  yield* deduplicateSuggestions(suggestions);
}

/**
 * Internal async helper for object suggest functionality.
 * @internal
 */
async function* suggestObjectAsync<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  prefix: string,
  parserPairs: readonly [string | symbol, Parser<Mode, unknown, unknown>][],
): AsyncGenerator<Suggestion> {
  // Build dependency runtime and populate registry via metadata.
  const runtime = createDependencyRuntimeContext(
    context.dependencyRegistry?.clone(),
  );
  const sourceParserPairs = filterExcludedFieldParsers(
    parserPairs,
    context.exec?.excludedSourceFields,
  );
  const nodes = buildRuntimeNodesFromPairs(
    sourceParserPairs as readonly (readonly [
      PropertyKey,
      Parser<Mode, unknown, unknown>,
    ])[],
    (context.state && typeof context.state === "object"
      ? context.state
      : {}) as Record<PropertyKey, unknown>,
    context.exec?.path,
  );
  await collectExplicitSourceValuesAsync(nodes, runtime);

  // Collect dependency sources from state tree.
  if (context.state && typeof context.state === "object") {
    collectSourcesFromState(
      context.state,
      runtime,
      new WeakSet<object>(),
      context.exec?.excludedSourceFields,
    );
  }
  // Pre-complete dependency source defaults (single evaluation point).
  await completeDependencySourceDefaultsAsync(
    context,
    sourceParserPairs,
    runtime.registry,
    context.exec,
  );

  // Expose the populated registry for child parsers' suggest() calls.
  const contextWithRegistry = {
    ...context,
    dependencyRegistry: runtime.registry,
    ...(context.exec != null
      ? {
        exec: {
          ...context.exec,
          dependencyRuntime: runtime,
          dependencyRegistry: runtime.registry,
        },
      }
      : {}),
  };

  // Check if the last token in the buffer is an option that requires a value.
  if (context.buffer.length > 0) {
    const lastToken = context.buffer[context.buffer.length - 1];

    // Find if any parser has this token as an option requiring a value
    for (const [field, parser] of parserPairs) {
      if (isOptionRequiringValue(parser.usage, lastToken)) {
        // Only get suggestions from the parser that owns this option
        const annotatedFieldState = getAnnotatedFieldState(
          context.state,
          field,
          parser,
        );

        const suggestions = parser.suggest(
          withChildContext(
            contextWithRegistry,
            field,
            annotatedFieldState,
            parser,
          ),
          prefix,
        ) as AsyncIterable<Suggestion>;
        for await (const s of suggestions) {
          yield s;
        }
        return;
      }
    }
  }

  // Default behavior: try getting suggestions from each parser
  const suggestions: Suggestion[] = [];
  for (const [field, parser] of parserPairs) {
    const annotatedFieldState = getAnnotatedFieldState(
      context.state,
      field,
      parser,
    );

    const fieldSuggestions = parser.suggest(
      withChildContext(
        contextWithRegistry,
        field,
        annotatedFieldState,
        parser,
      ),
      prefix,
    );

    // Handle both sync and async suggestions
    for await (const s of fieldSuggestions as AsyncIterable<Suggestion>) {
      suggestions.push(s);
    }
  }

  yield* deduplicateSuggestions(suggestions);
}

/**
 * Registers an already-resolved dependency source value in the registry
 * if it is a successful {@link DependencySourceState}.
 *
 * @internal
 */
function registerCompletedDependency(
  completed: unknown,
  registry: DependencyRegistryLike,
): void {
  if (
    isDependencySourceState(completed) && completed.result.success &&
    !registry.has(completed[dependencyId])
  ) {
    registry.set(completed[dependencyId], completed.result.value);
  }
}

/**
 * Yields `(parser, state)` pairs for dependency source parsers whose field
 * state is unpopulated, so callers can invoke `complete()` on them.
 *
 * @see https://github.com/dahlia/optique/issues/186
 * @internal
 */
function* pendingDependencyDefaults(
  context: ParserContext<unknown>,
  parserPairs: ReadonlyArray<
    readonly [string | symbol, Parser<Mode, unknown, unknown>]
  >,
  registry?: DependencyRegistryLike,
): Generator<
  { readonly parser: Parser<Mode, unknown, unknown>; readonly state: unknown }
> {
  for (const [field, fieldParser] of parserPairs) {
    const sourceId = fieldParser.dependencyMetadata?.source?.sourceId ??
      (isWrappedDependencySource(fieldParser)
        ? fieldParser[wrappedDependencySourceMarker][dependencyId]
        : isPendingDependencySourceState(fieldParser.initialState)
        ? (fieldParser.initialState as { [dependencyId]: symbol })[dependencyId]
        : undefined);
    if (sourceId != null && registry?.has(sourceId)) {
      continue;
    }

    const fieldState = context.state != null &&
        typeof context.state === "object" &&
        field in context.state
      ? (context.state as Record<string | symbol, unknown>)[field]
      : undefined;

    const annotatedFieldState = getAnnotatedFieldState(
      context.state,
      field,
      fieldParser,
    );

    if (
      fieldParser.dependencyMetadata?.source?.getMissingSourceValue != null &&
      isUnmatchedDependencyState(fieldState, fieldParser)
    ) {
      yield {
        parser: fieldParser,
        state: annotatedFieldState,
      };
      continue;
    }

    if (
      fieldParser.dependencyMetadata?.source != null &&
      isUnmatchedDependencyState(fieldState, fieldParser) &&
      (annotatedFieldState !== fieldState ||
        isNonCliBoundSourceState(fieldState, fieldParser))
    ) {
      yield {
        parser: fieldParser,
        state: annotatedFieldState,
      };
      continue;
    }

    if (fieldState != null) {
      // If the field has a non-null state but the parser wraps a dependency
      // source, it might be a bindEnv/bindConfig wrapper state where the CLI
      // option was not provided.  Pre-complete it so the dependency value is
      // registered for derived parsers.  Use getAnnotatedFieldState() so
      // that annotation inheritance respects inheritParentAnnotationsKey,
      // matching the behavior of object() Phase 1.
      if (
        !Array.isArray(fieldState) &&
        !isDependencySourceState(fieldState) &&
        (isWrappedDependencySource(fieldParser) ||
          isPendingDependencySourceState(fieldParser.initialState))
      ) {
        yield {
          parser: fieldParser,
          state: getAnnotatedFieldState(context.state, field, fieldParser),
        };
      }
      continue;
    }

    if (isPendingDependencySourceState(fieldParser.initialState)) {
      yield { parser: fieldParser, state: fieldParser.initialState };
    } else if (isWrappedDependencySource(fieldParser)) {
      yield {
        parser: fieldParser,
        state: [fieldParser[wrappedDependencySourceMarker]],
      };
    }
  }
}

/**
 * Pre-completes dependency source parsers wrapped in `withDefault()` whose
 * field state is unpopulated, so that their default values are registered
 * in the dependency registry.  This mirrors Phase 1 of parse-time dependency
 * resolution and ensures `suggest()` sees the same defaults as `parse()`.
 *
 * @see https://github.com/dahlia/optique/issues/186
 * @internal
 */
function completeDependencySourceDefaults(
  context: ParserContext<unknown>,
  parserPairs: ReadonlyArray<
    readonly [string | symbol, Parser<Mode, unknown, unknown>]
  >,
  registry: DependencyRegistryLike,
  exec?: ExecutionContext,
): void {
  for (
    const { parser, state } of pendingDependencyDefaults(
      context,
      parserPairs,
      registry,
    )
  ) {
    const completed = parser.complete(state, exec);
    const depState = wrapAsDependencySourceState(completed, parser);
    if (depState) registerCompletedDependency(depState, registry);
  }
}

/**
 * Wraps a completed result as a {@link DependencySourceState} if the parser
 * contains a dependency source and the result is a successful plain Result
 * with a defined value.  Returns the existing state if the result is already
 * a DependencySourceState, or `undefined` if no wrapping applies.
 *
 * This helper is shared by both `object()` Phase 1 and the suggest-time
 * pre-completion paths to keep the dep-ID selection and `value !== undefined`
 * rule in one place.
 * @internal
 */
function wrapAsDependencySourceState(
  completed: unknown,
  parser: Parser<Mode, unknown, unknown>,
): import("./dependency.ts").DependencySourceState | undefined {
  if (isDependencySourceState(completed)) return completed;
  const metadataSource = parser.dependencyMetadata?.source;
  if (metadataSource?.preservesSourceValue === false) {
    return undefined;
  }
  const hasDep = metadataSource != null ||
    isWrappedDependencySource(parser) ||
    isPendingDependencySourceState(parser.initialState);
  if (
    hasDep &&
    typeof completed === "object" && completed !== null &&
    "success" in completed && completed.success &&
    "value" in completed && completed.value !== undefined
  ) {
    const depId = metadataSource?.sourceId ??
      (isWrappedDependencySource(parser)
        ? parser[wrappedDependencySourceMarker][dependencyId]
        : (parser.initialState as { [dependencyId]: symbol })[dependencyId]);
    return createDependencySourceState(
      completed as { success: true; value: unknown },
      depId,
    );
  }
  return undefined;
}

/**
 * Async version of {@link completeDependencySourceDefaults} that awaits
 * `complete()` results.  Async parsers with `transformsDependencyValue`
 * return a `Promise` from `complete()`, which the sync version cannot handle.
 *
 * @see https://github.com/dahlia/optique/issues/186
 * @internal
 */
async function completeDependencySourceDefaultsAsync(
  context: ParserContext<unknown>,
  parserPairs: ReadonlyArray<
    readonly [string | symbol, Parser<Mode, unknown, unknown>]
  >,
  registry: DependencyRegistryLike,
  exec?: ExecutionContext,
): Promise<void> {
  for (
    const { parser, state } of pendingDependencyDefaults(
      context,
      parserPairs,
      registry,
    )
  ) {
    const completed = await parser.complete(state, exec);
    const depState = wrapAsDependencySourceState(completed, parser);
    if (depState) registerCompletedDependency(depState, registry);
  }
}

/**
 * Collects field-level parser pairs from child parsers that expose them
 * via {@link fieldParsersKey}.  Used by `merge()` to gather field→parser
 * mappings from its child `object()` (or nested `merge()`) parsers.
 * @internal
 */
/**
 * Removes entries for duplicate field names from a pre-completed results
 * map.  When a child construct's field-parser pairs contain the same field
 * name more than once (e.g., inner merges with overlapping output keys),
 * the flat map collapses branch-specific results.  This function strips
 * only the ambiguous entries, preserving cached results for unique fields.
 *
 * Returns `undefined` if the filtered map is empty (no cacheable fields).
 *
 * @see https://github.com/dahlia/optique/issues/762
 * @internal
 */
function filterDuplicateKeys(
  preCompleted: ReadonlyMap<string | symbol, unknown>,
  pairs: ReadonlyArray<readonly [string | symbol, unknown]>,
): ReadonlyMap<string | symbol, unknown> | undefined {
  const counts = new Map<string | symbol, number>();
  for (const [field] of pairs) {
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  let hasDuplicates = false;
  for (const count of counts.values()) {
    if (count > 1) {
      hasDuplicates = true;
      break;
    }
  }
  if (!hasDuplicates) return preCompleted;
  const filtered = new Map<string | symbol, unknown>();
  for (const [field, value] of preCompleted) {
    if ((counts.get(field) ?? 0) <= 1) {
      filtered.set(field, value);
    }
  }
  return filtered.size > 0 ? filtered : undefined;
}

function collectChildFieldParsers(
  parsers: readonly Parser<Mode, unknown, unknown>[],
): readonly (readonly [string | symbol, Parser<Mode, unknown, unknown>])[] {
  const pairs: (readonly [string | symbol, Parser<Mode, unknown, unknown>])[] =
    [];
  for (const parser of parsers) {
    if (fieldParsersKey in parser) {
      pairs.push(
        ...(
          parser as {
            [fieldParsersKey]: ReadonlyArray<
              readonly [string | symbol, Parser<Mode, unknown, unknown>]
            >;
          }
        )[fieldParsersKey],
      );
    }
  }
  return pairs;
}

function filterDuplicateFieldParsers<T>(
  pairs: ReadonlyArray<readonly [string | symbol, T]>,
): ReadonlyArray<readonly [string | symbol, T]> {
  const counts = new Map<string | symbol, number>();
  for (const [field] of pairs) {
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  return pairs.filter(([field]) => (counts.get(field) ?? 0) <= 1);
}

function collectDuplicateFieldNames(
  pairs: ReadonlyArray<readonly [string | symbol, unknown]>,
): ReadonlySet<string | symbol> {
  const counts = new Map<string | symbol, number>();
  for (const [field] of pairs) {
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([field]) => field),
  );
}

function filterExcludedFieldParsers<T>(
  pairs: ReadonlyArray<readonly [string | symbol, T]>,
  excludedFields?: ReadonlySet<string | symbol>,
): ReadonlyArray<readonly [string | symbol, T]> {
  if (excludedFields == null || excludedFields.size < 1) return pairs;
  return pairs.filter(([field]) => !excludedFields.has(field));
}

/**
 * Pre-completes dependency source fields and registers their values in
 * the given registry.  Unlike `completeDependencySourceDefaults()` (used
 * by suggest), this function handles all four Phase 1 cases — including
 * PendingDependencySourceState in arrays and wrappedDependencySourceMarker.
 *
 * The original state is NOT modified; only the registry is populated.
 *
 * Used by the new dependency runtime path as an old-protocol bridge:
 * not all wrappers (e.g., `bindConfig`, `bindEnv`) compose
 * `dependencyMetadata` yet, so metadata-based source collection alone
 * cannot register all dependency values.  This function fills the gap
 * by inspecting old-protocol markers on the parsers.
 * @internal
 */
function preCompleteAndRegisterDependencies(
  state: Record<string | symbol, unknown>,
  fieldParserPairs: ReadonlyArray<
    readonly [string | symbol, Parser<Mode, unknown, unknown>]
  >,
  registry: DependencyRegistryLike,
  exec?: ExecutionContext,
): Map<string | symbol, unknown> {
  const preCompleted = new Map<string | symbol, unknown>();
  // Read-only map from parent construct's Phase 1.  Never written to —
  // each construct builds its own map for children after this function
  // returns.  This prevents sibling completions from leaking results.
  // https://github.com/dahlia/optique/issues/762
  const parentResults = exec?.preCompletedByParser;
  for (const [field, fieldParser] of fieldParserPairs) {
    // If the parent construct's Phase 1 already completed this field,
    // reuse the full result (including wrapper-chain transformations)
    // to avoid re-evaluating non-idempotent defaults.
    const cached = parentResults?.get(field);
    if (cached !== undefined) {
      preCompleted.set(field, cached);
      registerCompletedDependency(cached, registry);
      continue;
    }

    const fieldState = state[field];
    const annotatedFieldState = getAnnotatedFieldState(
      state,
      field,
      fieldParser,
    );
    if (
      fieldParser.dependencyMetadata?.source?.getMissingSourceValue != null &&
      isUnmatchedDependencyState(fieldState, fieldParser)
    ) {
      const completed = fieldParser.complete(
        annotatedFieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
      continue;
    }

    if (
      fieldParser.dependencyMetadata?.source != null &&
      isUnmatchedDependencyState(fieldState, fieldParser) &&
      (annotatedFieldState !== fieldState ||
        isNonCliBoundSourceState(fieldState, fieldParser))
    ) {
      const completed = fieldParser.complete(
        annotatedFieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
      continue;
    }

    // Cases 1-3: pre-complete dependency sources that weren't provided.
    // Only register when complete() returns an actual DependencySourceState
    // (not force-wrapped), because wrappers like map() may intentionally
    // return a plain result that should NOT be registered as a source value.
    // Store the result so Phase 3 can reuse it without re-evaluating
    // potentially non-idempotent lazy defaults.
    if (
      Array.isArray(fieldState) &&
      fieldState.length === 1 &&
      isPendingDependencySourceState(fieldState[0])
    ) {
      // Case 1: state is [PendingDependencySourceState]
      const completed = fieldParser.complete(
        fieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      if (isDependencySourceState(completed)) {
        registerCompletedDependency(completed, registry);
      }
    } else if (
      fieldState === undefined &&
      isPendingDependencySourceState(fieldParser.initialState)
    ) {
      // Case 2: undefined state, parser.initialState is PendingDependencySourceState
      const completed = fieldParser.complete(
        [fieldParser.initialState],
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      if (isDependencySourceState(completed)) {
        registerCompletedDependency(completed, registry);
      }
    } else if (
      fieldState === undefined &&
      isWrappedDependencySource(fieldParser)
    ) {
      // Case 3: undefined state, parser has wrappedDependencySourceMarker
      const pendingState = fieldParser[wrappedDependencySourceMarker];
      const completed = fieldParser.complete(
        [pendingState],
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      if (isDependencySourceState(completed)) {
        registerCompletedDependency(completed, registry);
      }
    } // Case 4: non-null/non-array state, parser contains dependency source
    // (e.g., bindEnv/bindConfig wrapper state).  Force-wrap the result
    // because these wrappers return plain Results, not DependencySourceState.
    else if (
      fieldState != null &&
      !Array.isArray(fieldState) &&
      !isDependencySourceState(fieldState) &&
      (isWrappedDependencySource(fieldParser) ||
        isPendingDependencySourceState(fieldParser.initialState))
    ) {
      const annotatedFieldState = getAnnotatedFieldState(
        state,
        field,
        fieldParser,
      );
      const completed = fieldParser.complete(
        annotatedFieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
    }
  }
  return preCompleted;
}

/**
 * Async version of {@link preCompleteAndRegisterDependencies}.
 * @internal
 */
async function preCompleteAndRegisterDependenciesAsync(
  state: Record<string | symbol, unknown>,
  fieldParserPairs: ReadonlyArray<
    readonly [string | symbol, Parser<Mode, unknown, unknown>]
  >,
  registry: DependencyRegistryLike,
  exec?: ExecutionContext,
): Promise<Map<string | symbol, unknown>> {
  const preCompleted = new Map<string | symbol, unknown>();
  const parentResults = exec?.preCompletedByParser;
  for (const [field, fieldParser] of fieldParserPairs) {
    const cached = parentResults?.get(field);
    if (cached !== undefined) {
      preCompleted.set(field, cached);
      registerCompletedDependency(cached, registry);
      continue;
    }

    const fieldState = state[field];
    const annotatedFieldState = getAnnotatedFieldState(
      state,
      field,
      fieldParser,
    );
    if (
      fieldParser.dependencyMetadata?.source?.getMissingSourceValue != null &&
      isUnmatchedDependencyState(fieldState, fieldParser)
    ) {
      const completed = await fieldParser.complete(
        annotatedFieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
      continue;
    }

    if (
      fieldParser.dependencyMetadata?.source != null &&
      isUnmatchedDependencyState(fieldState, fieldParser) &&
      (annotatedFieldState !== fieldState ||
        isNonCliBoundSourceState(fieldState, fieldParser))
    ) {
      const completed = await fieldParser.complete(
        annotatedFieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
      continue;
    }

    // Cases 1-3: only register actual DependencySourceState.
    // Store result for reuse in Phase 3.
    if (
      Array.isArray(fieldState) &&
      fieldState.length === 1 &&
      isPendingDependencySourceState(fieldState[0])
    ) {
      const completed = await fieldParser.complete(
        fieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      if (isDependencySourceState(completed)) {
        registerCompletedDependency(completed, registry);
      }
    } else if (
      fieldState === undefined &&
      isPendingDependencySourceState(fieldParser.initialState)
    ) {
      const completed = await fieldParser.complete(
        [fieldParser.initialState],
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      if (isDependencySourceState(completed)) {
        registerCompletedDependency(completed, registry);
      }
    } else if (
      fieldState === undefined &&
      isWrappedDependencySource(fieldParser)
    ) {
      const pendingState = fieldParser[wrappedDependencySourceMarker];
      const completed = await fieldParser.complete(
        [pendingState],
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      if (isDependencySourceState(completed)) {
        registerCompletedDependency(completed, registry);
      }
    } // Case 4: force-wrap for bindEnv/bindConfig.
    else if (
      fieldState != null &&
      !Array.isArray(fieldState) &&
      !isDependencySourceState(fieldState) &&
      (isWrappedDependencySource(fieldParser) ||
        isPendingDependencySourceState(fieldParser.initialState))
    ) {
      const annotatedFieldState = getAnnotatedFieldState(
        state,
        field,
        fieldParser,
      );
      const completed = await fieldParser.complete(
        annotatedFieldState,
        withChildExecPath(exec, field),
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
    }
  }
  return preCompleted;
}

/**
 * Creates a parser that combines multiple parsers into a single object parser.
 * Each parser in the object is applied to parse different parts of the input,
 * and the results are combined into an object with the same structure.
 * @template T A record type where each value is a {@link Parser}.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  parsers: T,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a parser that combines multiple parsers into a single object parser.
 * Each parser in the object is applied to parse different parts of the input,
 * and the results are combined into an object with the same structure.
 * @template T A record type where each value is a {@link Parser}.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @param options Optional configuration for error customization.
 *                See {@link ObjectOptions}.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 * @since 0.5.0
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  parsers: T,
  options: ObjectOptions,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a single
 * object parser with an associated label for documentation or error reporting.
 * @template T A record type where each value is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  label: string,
  parsers: T,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a single
 * object parser with an associated label for documentation or error reporting.
 * @template T A record type where each value is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An object containing named parsers that will be combined
 *                into a single object parser.
 * @param options Optional configuration for error customization.
 *                See {@link ObjectOptions}.
 * @returns A {@link Parser} that produces an object with the same keys as
 *          the input, where each value is the result of the corresponding
 *          parser.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 * @since 0.5.0
 */
export function object<
  T extends { readonly [key: string | symbol]: Parser<Mode, unknown, unknown> },
>(
  label: string,
  parsers: T,
  options: ObjectOptions,
): Parser<
  CombineObjectModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

export function object<
  T extends {
    readonly [key: string | symbol]: Parser<Mode, unknown, unknown>;
  },
>(
  labelOrParsers: string | T,
  maybeParsersOrOptions?: T | ObjectOptions,
  maybeOptions?: ObjectOptions,
): Parser<
  Mode,
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;
  if (label != null) validateLabel(label);

  let parsers: T;
  let options: ObjectOptions = {};

  if (typeof labelOrParsers === "string") {
    // object(label, parsers) or object(label, parsers, options)
    parsers = maybeParsersOrOptions as T;
    options = maybeOptions ?? {};
  } else {
    // object(parsers) or object(parsers, options)
    parsers = labelOrParsers;
    options = (maybeParsersOrOptions as ObjectOptions) ?? {};
  }
  const parserKeys = Reflect.ownKeys(parsers) as (keyof T)[];
  const parserPairs = parserKeys.map((k) =>
    [k, parsers[k]] as [keyof T, Parser<Mode, unknown, unknown>]
  );
  parserPairs.sort(([_, parserA], [__, parserB]) =>
    parserB.priority - parserA.priority
  );
  const createInitialState = (): Record<string | symbol, unknown> => {
    const state: Record<string | symbol, unknown> = {};
    for (const key of parserKeys) {
      state[key as string | symbol] = parsers[key].initialState;
    }
    return state;
  };
  const inheritedFieldStateCache = new WeakMap<
    object,
    WeakMap<typeof getAnnotatedChildState, Map<string | symbol, unknown>>
  >();
  const createFieldStateGetter = (
    parentState: unknown,
    annotateChildState = getAnnotatedChildState,
  ) => {
    return (
      field: keyof T,
      parser: Parser<Mode, unknown, unknown>,
    ): unknown => {
      const fieldKey = field as string | symbol;
      const cache = parentState != null && typeof parentState === "object"
        ? (() => {
          const annotatorCaches = inheritedFieldStateCache.get(parentState) ??
            (() => {
              const nextCaches = new WeakMap<
                typeof getAnnotatedChildState,
                Map<string | symbol, unknown>
              >();
              inheritedFieldStateCache.set(parentState, nextCaches);
              return nextCaches;
            })();
          return annotatorCaches.get(annotateChildState) ??
            (() => {
              const stateCache = new Map<string | symbol, unknown>();
              annotatorCaches.set(annotateChildState, stateCache);
              return stateCache;
            })();
        })()
        : undefined;
      if (cache?.has(fieldKey)) {
        return cache.get(fieldKey);
      }
      const sourceState = parentState != null &&
          typeof parentState === "object" &&
          fieldKey in parentState
        ? (parentState as Record<string | symbol, unknown>)[fieldKey]
        : parser.initialState;
      const inheritedState = annotateChildState(
        parentState,
        sourceState,
        parser,
      );
      cache?.set(fieldKey, inheritedState);
      return inheritedState;
    };
  };

  // Check for duplicate option names at construction time unless explicitly allowed
  if (!options.allowDuplicates) {
    checkDuplicateOptionNames(
      parserPairs.map(([field, parser]) =>
        [field as string | symbol, parser.usage] as const
      ),
    );
  }

  // Analyze context once for error message generation
  const noMatchContext = analyzeNoMatchContext(
    parserKeys.map((k) => parsers[k]),
  );

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parserKeys.some(
      (k) => parsers[k].$mode === "async",
    )
    ? "async"
    : "sync";

  // Helper function for sync parsing of a single field
  type ParseResult = ParserResult<{ readonly [K in keyof T]: unknown }>;
  const getInitialError = (
    context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  ): { consumed: number; error: Message } => ({
    consumed: 0,
    error: context.buffer.length > 0
      ? (() => {
        const token = context.buffer[0];
        const customMessage = options.errors?.unexpectedInput;

        // If custom error message is provided, use it
        if (customMessage) {
          return typeof customMessage === "function"
            ? customMessage(token)
            : customMessage;
        }

        // Generate default error with suggestions
        const baseError = message`Unexpected option or argument: ${token}.`;
        return createErrorWithSuggestions(
          baseError,
          token,
          context.usage,
          "both",
          options.errors?.suggestions,
        );
      })()
      : (() => {
        const customEndOfInput = options.errors?.endOfInput;
        return customEndOfInput
          ? (typeof customEndOfInput === "function"
            ? customEndOfInput(noMatchContext)
            : customEndOfInput)
          : generateNoMatchError(noMatchContext);
      })(),
  });

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  ): ParseResult => {
    let error = getInitialError(context);

    // Try greedy parsing: attempt to consume as many fields as possible
    let currentContext = context;
    let anySuccess = false;
    const allConsumed: string[] = [];
    const consumedFields = new Set<string | symbol>();

    // Keep trying to parse fields until no more can be matched
    let madeProgress = true;
    while (madeProgress && currentContext.buffer.length > 0) {
      madeProgress = false;
      const getFieldState = createFieldStateGetter(
        currentContext.state,
        getObjectParseChildState,
      );

      for (const [field, parser] of parserPairs) {
        const result = (parser as Parser<"sync", unknown, unknown>).parse(
          withChildContext(
            currentContext,
            field,
            getFieldState(field, parser),
            parser,
          ),
        );

        if (result.success && result.consumed.length > 0) {
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: getAnnotatedChildState(
                currentContext.state,
                result.next.state,
                parser,
              ),
            } as { readonly [K in keyof T]: unknown },
            ...(mergedExec != null
              ? {
                trace: mergedExec.trace,
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };
          allConsumed.push(...result.consumed);
          anySuccess = true;
          madeProgress = true;
          consumedFields.add(field as string | symbol);
          break; // Restart the field loop with updated context
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }
    }

    // Zero-consumption pass: let purely non-interactive parsers update
    // their state.  Parsers like multiple(constant(...)),
    // optional(constant(...)), and withDefault(constant(...)) modify
    // state in parse() even when they return consumed: [].  The greedy
    // loop above skips these state changes, so we give each
    // non-consumed field one parse() call here.  Only parsers with no
    // leading names and no catch-all token acceptance qualify: parsers
    // that could still match a later token (e.g., option(), argument(),
    // or the leading-name branches of or()) must not have their state
    // committed here, because doing so would hide still-valid branches
    // from suggestions and docs.
    {
      const getFieldState = createFieldStateGetter(
        currentContext.state,
        getObjectParseChildState,
      );
      for (const [field, parser] of parserPairs) {
        if (consumedFields.has(field as string | symbol)) continue;
        const typedParser = parser as Parser<"sync", unknown, unknown>;
        if (
          parser.leadingNames.size > 0 ||
          typedParser.acceptingAnyToken
        ) {
          continue;
        }
        const fieldState = getFieldState(field, parser);
        const result = typedParser.parse(
          withChildContext(
            currentContext,
            field,
            fieldState,
            parser,
          ),
        );
        if (
          result.success && result.consumed.length === 0 &&
          result.next.state !== fieldState
        ) {
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: getAnnotatedChildState(
                currentContext.state,
                result.next.state,
                parser,
              ),
            } as { readonly [K in keyof T]: unknown },
            ...(mergedExec != null
              ? {
                trace: mergedExec.trace,
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };
        }
      }
    }

    // If we consumed any input, return success
    if (anySuccess) {
      return {
        success: true,
        next: currentContext,
        consumed: allConsumed,
      };
    }

    // If buffer is empty and no parser consumed input, check if all parsers
    // can complete.  Use currentContext (not the original context) so that
    // state changes from the zero-consumption pass are visible.
    if (currentContext.buffer.length === 0) {
      let allCanComplete = true;
      const getFieldState = createFieldStateGetter(currentContext.state);
      // Stamp the probe exec as parse-phase so that async fallback
      // guards in or()/conditional() correctly suppress side effects.
      const probeExec = currentContext.exec
        ? { ...currentContext.exec, phase: "parse" as const }
        : {
          usage: [] as never[],
          path: [] as PropertyKey[],
          trace: undefined,
          phase: "parse" as const,
        };
      for (const [field, parser] of parserPairs) {
        const fieldState = getFieldState(field, parser);
        const completeResult = (parser as Parser<"sync", unknown, unknown>)
          .complete(fieldState, withChildExecPath(probeExec, field));
        if (!completeResult.success) {
          allCanComplete = false;
          break;
        }
      }

      if (allCanComplete) {
        return {
          success: true,
          next: currentContext,
          consumed: [],
        };
      }
    }

    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<{ readonly [K in keyof T]: unknown }>,
  ): Promise<ParseResult> => {
    let error = getInitialError(context);

    // Try greedy parsing: attempt to consume as many fields as possible
    let currentContext = context;
    let anySuccess = false;
    const allConsumed: string[] = [];
    const consumedFields = new Set<string | symbol>();

    // Keep trying to parse fields until no more can be matched
    let madeProgress = true;
    while (madeProgress && currentContext.buffer.length > 0) {
      madeProgress = false;
      const getFieldState = createFieldStateGetter(
        currentContext.state,
        getObjectParseChildState,
      );

      for (const [field, parser] of parserPairs) {
        const resultOrPromise = parser.parse(
          withChildContext(
            currentContext,
            field,
            getFieldState(field, parser),
            parser,
          ),
        );
        const result = await resultOrPromise;

        if (result.success && result.consumed.length > 0) {
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: getAnnotatedChildState(
                currentContext.state,
                result.next.state,
                parser,
              ),
            } as { readonly [K in keyof T]: unknown },
            ...(mergedExec != null
              ? {
                trace: mergedExec.trace,
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };
          allConsumed.push(...result.consumed);
          anySuccess = true;
          madeProgress = true;
          consumedFields.add(field as string | symbol);
          break; // Restart the field loop with updated context
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }
    }

    // Zero-consumption pass: let purely non-interactive parsers update
    // their state (see sync counterpart for rationale).
    {
      const getFieldState = createFieldStateGetter(
        currentContext.state,
        getObjectParseChildState,
      );
      for (const [field, parser] of parserPairs) {
        if (consumedFields.has(field as string | symbol)) continue;
        if (
          parser.leadingNames.size > 0 ||
          parser.acceptingAnyToken
        ) {
          continue;
        }
        const fieldState = getFieldState(field, parser);
        const resultOrPromise = parser.parse(
          withChildContext(
            currentContext,
            field,
            fieldState,
            parser,
          ),
        );
        const result = await resultOrPromise;
        if (
          result.success && result.consumed.length === 0 &&
          result.next.state !== fieldState
        ) {
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: getAnnotatedChildState(
                currentContext.state,
                result.next.state,
                parser,
              ),
            } as { readonly [K in keyof T]: unknown },
            ...(mergedExec != null
              ? {
                trace: mergedExec.trace,
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };
        }
      }
    }

    // If we consumed any input, return success
    if (anySuccess) {
      return {
        success: true,
        next: currentContext,
        consumed: allConsumed,
      };
    }

    // If buffer is empty and no parser consumed input, check if all parsers
    // can complete.  Use currentContext (not the original context) so that
    // state changes from the zero-consumption pass are visible.
    if (currentContext.buffer.length === 0) {
      let allCanComplete = true;
      const getFieldState = createFieldStateGetter(currentContext.state);
      // Stamp the probe exec as parse-phase so that async fallback
      // guards in or()/conditional() correctly suppress side effects
      // (see sync counterpart for rationale).
      const probeExec = currentContext.exec
        ? { ...currentContext.exec, phase: "parse" as const }
        : {
          usage: [] as never[],
          path: [] as PropertyKey[],
          trace: undefined,
          phase: "parse" as const,
        };
      for (const [field, parser] of parserPairs) {
        const fieldState = getFieldState(field, parser);
        const completeResult = await parser.complete(
          fieldState,
          withChildExecPath(probeExec, field),
        );
        if (!completeResult.success) {
          allCanComplete = false;
          break;
        }
      }

      if (allCanComplete) {
        return {
          success: true,
          next: currentContext,
          consumed: [],
        };
      }
    }

    return { ...error, success: false };
  };

  const objectParser = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    [fieldParsersKey]: parserPairs,
    priority: Math.max(...parserKeys.map((k) => parsers[k].priority)),
    usage: applyHiddenToUsage(
      parserPairs.flatMap(([_, p]) => p.usage),
      options.hidden,
    ),
    leadingNames: sharedBufferLeadingNames(parserPairs.map(([_, p]) => p)),
    acceptingAnyToken: parserPairs.some(([_, p]) => p.acceptingAnyToken),
    get initialState(): {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    } {
      return createInitialState() as {
        readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
          ? U3
          : never;
      };
    },
    parse(
      context: ParserContext<{ readonly [K in keyof T]: unknown }>,
    ) {
      return dispatchByMode(
        combinedMode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    getSuggestRuntimeNodes(
      state: { readonly [K in keyof T]: unknown },
      path: readonly PropertyKey[],
    ) {
      const stateRecord = state != null && typeof state === "object"
        ? state as Record<PropertyKey, unknown>
        : objectParser.initialState as Record<PropertyKey, unknown>;
      return buildSuggestRuntimeNodesFromPairs(parserPairs, stateRecord, path);
    },
    complete(
      state: { readonly [K in keyof T]: unknown },
      exec?: ExecutionContext,
    ) {
      return dispatchByMode(
        combinedMode,
        () => {
          // Phase 1: Build dependency runtime and pre-complete dependency
          // source parsers.  Reuse the parent's runtime if present so that
          // nested objects share dependency state across the parse tree.
          //
          // Pre-completion is the single evaluation point for lazy defaults:
          // each source's complete() is called exactly once, its result is
          // stored for reuse in Phase 3, and the dependency value is
          // registered in the runtime for derived-parser replay.
          // resolveStateWithRuntime (Phase 2) then collects matched
          // DependencySourceState from the raw state tree, which may
          // overwrite defaults with actual CLI values — that is correct.
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const typedParserPairs = filterExcludedFieldParsers(
            parserPairs as readonly (readonly [
              string | symbol,
              Parser<Mode, unknown, unknown>,
            ])[],
            exec?.excludedSourceFields,
          );
          const preCompleted = preCompleteAndRegisterDependencies(
            state as Record<string | symbol, unknown>,
            typedParserPairs,
            runtime.registry,
            childExec,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;

          // Phase 2: Resolve all DeferredParseState in the state tree
          // using the dependency runtime.  This recursively finds and
          // replays derived parsers at any nesting depth (including
          // inside multiple() arrays and modifier chains).
          // Build the full annotated state, then resolve the ENTIRE object
          // at once so that source collection sees all fields before any
          // DeferredParseState is replayed (order-independent resolution).
          const getFieldState = createFieldStateGetter(state);
          const annotatedState: Record<string | symbol, unknown> = {};
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field] as Parser<
              "sync",
              unknown,
              unknown
            >;
            annotatedState[fieldKey] = getFieldState(field, fieldParser);
          }
          collectExplicitSourceValues(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromPairs(
                typedParserPairs,
                annotatedState,
                exec?.path,
              ),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const resolvedFieldStates = resolveStateWithRuntime(
            annotatedState,
            runtime,
          ) as Record<string | symbol, unknown>;

          // Phase 3: Complete each field using resolved state.
          // For pre-completed dependency sources, reuse the Phase 1b result
          // to avoid re-evaluating non-idempotent lazy defaults.
          const result = {} as {
            [K in keyof T]: T[K]["$valueType"][number];
          };
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field] as Parser<
              "sync",
              unknown,
              unknown
            >;

            let valueResult: import("./valueparser.ts").ValueParserResult<
              unknown
            >;
            const preCompletedResult = preCompleted.get(fieldKey);
            if (preCompletedResult !== undefined) {
              // Reuse the Phase 1b result to preserve consistency with
              // the dependency value that derived parsers were validated
              // against.
              valueResult = unwrapCompleteResult(preCompletedResult);
            } else {
              const fieldState = resolvedFieldStates[fieldKey];
              valueResult = unwrapCompleteResult(
                fieldParser.complete(
                  fieldState,
                  withChildExecPath(phase3Exec, fieldKey),
                ),
              );
            }
            if (valueResult.success) {
              (result as Record<string | symbol, unknown>)[fieldKey] =
                valueResult.value;
              if (valueResult.deferred) {
                if (valueResult.deferredKeys) {
                  deferredKeys.set(fieldKey, valueResult.deferredKeys);
                } else if (
                  valueResult.value == null ||
                  typeof valueResult.value !== "object"
                ) {
                  deferredKeys.set(fieldKey, null);
                } else {
                  hasDeferred = true;
                }
              }
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }
          const isDeferred = deferredKeys.size > 0 || hasDeferred;
          return {
            success: true as const,
            value: result,
            ...(isDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
        async () => {
          // Phase 1: Build dependency runtime and pre-complete dependency
          // source parsers (single evaluation point for lazy defaults).
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const asyncParserPairs = filterExcludedFieldParsers(
            parserPairs as readonly (readonly [
              string | symbol,
              Parser<Mode, unknown, unknown>,
            ])[],
            exec?.excludedSourceFields,
          );
          const preCompleted = await preCompleteAndRegisterDependenciesAsync(
            state as Record<string | symbol, unknown>,
            asyncParserPairs,
            runtime.registry,
            childExec,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;

          // Phase 2: Build the full annotated state, then resolve the
          // ENTIRE object at once for order-independent resolution.
          const getFieldState = createFieldStateGetter(state);
          const annotatedState: Record<string | symbol, unknown> = {};
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];
            annotatedState[fieldKey] = getFieldState(field, fieldParser);
          }
          await collectExplicitSourceValuesAsync(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromPairs(
                asyncParserPairs,
                annotatedState,
                exec?.path,
              ),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const resolvedFieldStates = await resolveStateWithRuntimeAsync(
            annotatedState,
            runtime,
          ) as Record<string | symbol, unknown>;

          // Phase 3: Complete each field using resolved state.
          // For pre-completed dependency sources, reuse the Phase 1b result.
          const result = {} as {
            [K in keyof T]: T[K]["$valueType"][number];
          };
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          const applyValueResult = (
            fieldKey: string | symbol,
            valueResult: ValueParserResult<unknown>,
          ) => {
            if (valueResult.success) {
              (result as Record<string | symbol, unknown>)[fieldKey] =
                valueResult.value;
              if (valueResult.deferred) {
                if (valueResult.deferredKeys) {
                  deferredKeys.set(fieldKey, valueResult.deferredKeys);
                } else if (
                  valueResult.value == null ||
                  typeof valueResult.value !== "object"
                ) {
                  deferredKeys.set(fieldKey, null);
                } else {
                  hasDeferred = true;
                }
              }
            } else {
              return { success: false as const, error: valueResult.error };
            }
            return undefined;
          };
          const concurrentFields: (keyof T)[] = [];
          const deferredFields: (keyof T)[] = [];
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];
            const preCompletedResult = preCompleted.get(fieldKey);
            if (preCompletedResult !== undefined) {
              const failure = applyValueResult(
                fieldKey,
                unwrapCompleteResult(preCompletedResult),
              );
              if (failure != null) return failure;
              continue;
            }
            if (
              typeof fieldParser.shouldDeferCompletion === "function" &&
              fieldParser.shouldDeferCompletion(
                  resolvedFieldStates[fieldKey],
                  withChildExecPath(phase3Exec, fieldKey),
                ) === true
            ) {
              deferredFields.push(field);
            } else {
              concurrentFields.push(field);
            }
          }
          const concurrentResults = await Promise.all(
            concurrentFields.map(async (field) => {
              const fieldKey = field as string | symbol;
              const fieldParser = parsers[field];
              const valueResult = unwrapCompleteResult(
                await fieldParser.complete(
                  resolvedFieldStates[fieldKey],
                  withChildExecPath(phase3Exec, fieldKey),
                ),
              );
              return { fieldKey, valueResult } as const;
            }),
          );
          for (const { fieldKey, valueResult } of concurrentResults) {
            const failure = applyValueResult(fieldKey, valueResult);
            if (failure != null) return failure;
          }
          for (const field of deferredFields) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];
            const valueResult = unwrapCompleteResult(
              await fieldParser.complete(
                resolvedFieldStates[fieldKey],
                withChildExecPath(phase3Exec, fieldKey),
              ),
            );
            const failure = applyValueResult(fieldKey, valueResult);
            if (failure != null) return failure;
          }

          const isDeferred = deferredKeys.size > 0 || hasDeferred;
          return {
            success: true as const,
            value: result,
            ...(isDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
      );
    },
    [extractPhase2SeedKey](
      state: { readonly [K in keyof T]: unknown },
      exec?: ExecutionContext,
    ) {
      return dispatchByMode(
        combinedMode,
        () => {
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const typedParserPairs = filterExcludedFieldParsers(
            parserPairs as readonly (readonly [
              string | symbol,
              Parser<Mode, unknown, unknown>,
            ])[],
            exec?.excludedSourceFields,
          );
          const preCompleted = preCompleteAndRegisterDependencies(
            state as Record<string | symbol, unknown>,
            typedParserPairs,
            runtime.registry,
            childExec,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;

          const getFieldState = createFieldStateGetter(state);
          const annotatedState: Record<string | symbol, unknown> = {};
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field] as Parser<
              "sync",
              unknown,
              unknown
            >;
            annotatedState[fieldKey] = getFieldState(field, fieldParser);
          }
          collectExplicitSourceValues(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromPairs(
                typedParserPairs,
                annotatedState,
                exec?.path,
              ),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const resolvedFieldStates = resolveStateWithRuntime(
            annotatedState,
            runtime,
          ) as Record<string | symbol, unknown>;

          const result = {} as {
            [K in keyof T]: T[K]["$valueType"][number];
          };
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field] as Parser<
              "sync",
              unknown,
              unknown
            >;
            const childExec = withChildExecPath(phase3Exec, fieldKey);
            const preCompletedResult = preCompleted.get(fieldKey);
            const seed = preCompletedResult !== undefined
              ? reusePreCompletedPhase2Seed(
                fieldParser,
                resolvedFieldStates[fieldKey],
                preCompletedResult,
                childExec,
              )
              : completeOrExtractPhase2Seed(
                fieldParser,
                resolvedFieldStates[fieldKey],
                childExec,
              );
            if (seed == null) continue;
            hasAnySeed = true;
            (result as Record<string | symbol, unknown>)[fieldKey] = seed.value;
            if (seed.deferred) {
              if (seed.deferredKeys) {
                deferredKeys.set(fieldKey, seed.deferredKeys);
              } else if (
                seed.value == null ||
                typeof seed.value !== "object"
              ) {
                deferredKeys.set(fieldKey, null);
              } else {
                hasDeferred = true;
              }
            }
          }

          if (!hasAnySeed) return null;
          return {
            value: result,
            ...(deferredKeys.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
        async () => {
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const asyncParserPairs = filterExcludedFieldParsers(
            parserPairs as readonly (readonly [
              string | symbol,
              Parser<Mode, unknown, unknown>,
            ])[],
            exec?.excludedSourceFields,
          );
          const preCompleted = await preCompleteAndRegisterDependenciesAsync(
            state as Record<string | symbol, unknown>,
            asyncParserPairs,
            runtime.registry,
            childExec,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;

          const getFieldState = createFieldStateGetter(state);
          const annotatedState: Record<string | symbol, unknown> = {};
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];
            annotatedState[fieldKey] = getFieldState(field, fieldParser);
          }
          await collectExplicitSourceValuesAsync(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromPairs(
                asyncParserPairs,
                annotatedState,
                exec?.path,
              ),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const resolvedFieldStates = await resolveStateWithRuntimeAsync(
            annotatedState,
            runtime,
          ) as Record<string | symbol, unknown>;

          const result = {} as {
            [K in keyof T]: T[K]["$valueType"][number];
          };
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];
            const childExec = withChildExecPath(phase3Exec, fieldKey);
            const preCompletedResult = preCompleted.get(fieldKey);
            const seed = preCompletedResult !== undefined
              ? await reusePreCompletedPhase2SeedAsync(
                fieldParser,
                resolvedFieldStates[fieldKey],
                preCompletedResult,
                childExec,
              )
              : await completeOrExtractPhase2Seed(
                fieldParser,
                resolvedFieldStates[fieldKey],
                childExec,
              );
            if (seed == null) continue;
            hasAnySeed = true;
            (result as Record<string | symbol, unknown>)[fieldKey] = seed.value;
            if (seed.deferred) {
              if (seed.deferredKeys) {
                deferredKeys.set(fieldKey, seed.deferredKeys);
              } else if (
                seed.value == null ||
                typeof seed.value !== "object"
              ) {
                deferredKeys.set(fieldKey, null);
              } else {
                hasDeferred = true;
              }
            }
          }

          if (!hasAnySeed) return null;
          return {
            value: result,
            ...(deferredKeys.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
      );
    },
    suggest(
      context: ParserContext<{ readonly [K in keyof T]: unknown }>,
      prefix: string,
    ) {
      if (options.hidden === true) {
        return dispatchIterableByMode(
          combinedMode,
          function* () {},
          async function* () {},
        );
      }
      return dispatchIterableByMode(
        combinedMode,
        () => {
          const syncParserPairs = parserPairs as [
            string | symbol,
            Parser<"sync", unknown, unknown>,
          ][];
          return suggestObjectSync(context, prefix, syncParserPairs);
        },
        () =>
          suggestObjectAsync(
            context,
            prefix,
            parserPairs as [string | symbol, Parser<Mode, unknown, unknown>][],
          ),
      );
    },
    getDocFragments(
      state: DocState<{ readonly [K in keyof T]: unknown }>,
      defaultValue?: { readonly [K in keyof T]: unknown },
    ) {
      const fragments = parserPairs.flatMap(([field, p]) => {
        const fieldState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "available", state: state.state[field] };
        return p.getDocFragments(fieldState, defaultValue?.[field]).fragments;
      });
      const hiddenAwareFragments = applyHiddenToDocFragments(
        fragments,
        options.hidden,
      );
      const entries: DocEntry[] = hiddenAwareFragments.filter((d) =>
        d.type === "entry"
      );
      const sections: DocSection[] = [];
      for (const fragment of hiddenAwareFragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const section: DocSection = { title: label, entries };
      sections.push(section);
      return { fragments: sections.map((s) => ({ ...s, type: "section" })) };
    },
    // Type assertion needed because TypeScript cannot verify the combined mode
    // of multiple parsers at compile time. Runtime behavior is correct via mode dispatch.
  } as unknown as Parser<
    Mode,
    { readonly [K in keyof T]: unknown },
    { readonly [K in keyof T]: unknown }
  >;

  // Build composite normalizeValue from field parsers that have normalizers.
  const fieldNormalizers: [string | symbol, (v: unknown) => unknown][] = [];
  for (const [key, fieldParser] of parserPairs) {
    if (typeof fieldParser.normalizeValue === "function") {
      fieldNormalizers.push([
        key as string | symbol,
        fieldParser.normalizeValue.bind(fieldParser),
      ]);
    }
  }
  if (fieldNormalizers.length > 0) {
    type ObjType = { readonly [K in keyof T]: unknown };
    Object.defineProperty(objectParser, "normalizeValue", {
      value(obj: ObjType): ObjType {
        if (typeof obj !== "object" || obj == null) return obj;
        let changed = false;
        let result: Record<string | symbol, unknown> | undefined;
        for (const [key, normalize] of fieldNormalizers) {
          if (Object.hasOwn(obj, key)) {
            try {
              const original = (obj as Record<string | symbol, unknown>)[key];
              const normalized = normalize(original);
              if (normalized !== original) {
                if (!result) {
                  result = { ...obj } as Record<string | symbol, unknown>;
                }
                result[key] = normalized;
                changed = true;
              }
            } catch {
              // best-effort; skip fields that fail normalization
            }
          }
        }
        return (changed ? result : obj) as ObjType;
      },
      configurable: true,
      enumerable: false,
    });
  }

  defineInheritedAnnotationParser(objectParser);
  return objectParser;
}

/**
 * Options for the {@link tuple} parser.
 * @since 0.7.0
 */
export interface TupleOptions {
  /**
   * When `true`, allows duplicate option names across different parsers.
   * By default (`false`), duplicate option names will cause a parse error.
   *
   * @default `false`
   * @since 0.7.0
   */
  readonly allowDuplicates?: boolean;
}

function suggestTupleSync(
  context: ParserContext<readonly unknown[]>,
  prefix: string,
  parsers: readonly Parser<"sync", unknown, unknown>[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const advanced = advanceTupleSuggestContextSync(context, parsers);
  const advancedContext = advanced.context;
  const stateArray = advancedContext.state as unknown[] | undefined;
  const runtime = createDependencyRuntimeContext(
    advancedContext.dependencyRegistry?.clone(),
  );
  if (stateArray && Array.isArray(stateArray)) {
    const nodes = buildSuggestRuntimeNodesFromArray(
      parsers,
      stateArray,
      advancedContext.exec?.path,
    );
    collectExplicitSourceValues(nodes, runtime);
    fillMissingSourceDefaults(nodes, runtime);
    collectSourcesFromState(stateArray, runtime);
    completeDependencySourceDefaults(
      {
        ...advancedContext,
        state: createAnnotatedArrayStateRecord(stateArray),
      },
      buildIndexedParserPairs(parsers),
      runtime.registry,
      advancedContext.exec,
    );
  }
  markFailedTupleSuggestSources(
    parsers,
    stateArray,
    advanced.failedParserIndexes,
    runtime,
    advancedContext.exec?.path,
  );
  const contextWithRegistry = {
    ...advancedContext,
    dependencyRegistry: runtime.registry,
    ...(advancedContext.exec != null
      ? {
        exec: {
          ...advancedContext.exec,
          dependencyRuntime: runtime,
          dependencyRegistry: runtime.registry,
        },
      }
      : {}),
  };

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[i]
      : parser.initialState;

    const parserSuggestions = parser.suggest(
      withChildContext(contextWithRegistry, i, parserState, parser),
      prefix,
    );

    suggestions.push(...parserSuggestions);
  }

  return deduplicateSuggestions(suggestions);
}

async function* suggestTupleAsync(
  context: ParserContext<readonly unknown[]>,
  prefix: string,
  parsers: readonly Parser<Mode, unknown, unknown>[],
): AsyncGenerator<Suggestion> {
  const suggestions: Suggestion[] = [];
  const advanced = await advanceTupleSuggestContextAsync(
    context,
    parsers,
  );
  const advancedContext = advanced.context;
  const stateArray = advancedContext.state as unknown[] | undefined;
  const runtime = createDependencyRuntimeContext(
    advancedContext.dependencyRegistry?.clone(),
  );
  if (stateArray && Array.isArray(stateArray)) {
    const nodes = buildSuggestRuntimeNodesFromArray(
      parsers,
      stateArray,
      advancedContext.exec?.path,
    );
    await collectExplicitSourceValuesAsync(nodes, runtime);
    await fillMissingSourceDefaultsAsync(nodes, runtime);
    collectSourcesFromState(stateArray, runtime);
    await completeDependencySourceDefaultsAsync(
      {
        ...advancedContext,
        state: createAnnotatedArrayStateRecord(stateArray),
      },
      buildIndexedParserPairs(parsers),
      runtime.registry,
      advancedContext.exec,
    );
  }
  await markFailedTupleSuggestSourcesAsync(
    parsers,
    stateArray,
    advanced.failedParserIndexes,
    runtime,
    advancedContext.exec?.path,
  );
  const contextWithRegistry = {
    ...advancedContext,
    dependencyRegistry: runtime.registry,
    ...(advancedContext.exec != null
      ? {
        exec: {
          ...advancedContext.exec,
          dependencyRuntime: runtime,
          dependencyRegistry: runtime.registry,
        },
      }
      : {}),
  };

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[i]
      : parser.initialState;

    const parserSuggestions = parser.suggest(
      withChildContext(contextWithRegistry, i, parserState, parser),
      prefix,
    );

    if (parser.$mode === "async") {
      for await (const s of parserSuggestions as AsyncIterable<Suggestion>) {
        suggestions.push(s);
      }
    } else {
      suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
    }
  }

  yield* deduplicateSuggestions(suggestions);
}

interface TupleSuggestAdvanceResult {
  readonly context: ParserContext<readonly unknown[]>;
  readonly failedParserIndexes: readonly number[];
}

function advanceTupleSuggestContextSync(
  context: ParserContext<readonly unknown[]>,
  parsers: readonly Parser<"sync", unknown, unknown>[],
): TupleSuggestAdvanceResult {
  let currentContext = context;
  const matchedParsers = new Set<number>();

  while (
    currentContext.buffer.length > 0 && matchedParsers.size < parsers.length
  ) {
    let foundMatch = false;
    let failedParserIndexes: number[] = [];
    let deepestFailure = 0;
    const stateArray = Array.isArray(currentContext.state)
      ? [...currentContext.state]
      : parsers.map((parser) => parser.initialState);
    const remainingParsers = parsers
      .map((parser, index) => [parser, index] as const)
      .filter(([_, index]) => !matchedParsers.has(index))
      .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

    for (const [parser, index] of remainingParsers) {
      const result = parser.parse(
        withChildContext(currentContext, index, stateArray[index], parser),
      );

      if (result.success && result.consumed.length > 0) {
        const newStateArray = annotateFreshArray(
          currentContext.state,
          stateArray.map((state, idx) =>
            idx === index
              ? getAnnotatedChildState(
                currentContext.state,
                result.next.state,
                parser,
              )
              : state
          ),
        );
        const mergedExec = mergeChildExec(
          currentContext.exec,
          result.next.exec,
        );
        currentContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newStateArray as readonly unknown[],
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        };
        matchedParsers.add(index);
        foundMatch = true;
        break;
      } else if (!result.success && result.consumed > 0) {
        if (result.consumed > deepestFailure) {
          deepestFailure = result.consumed;
          failedParserIndexes = [index];
        } else if (result.consumed === deepestFailure) {
          failedParserIndexes.push(index);
        }
      }
    }

    if (!foundMatch) {
      for (const [parser, index] of remainingParsers) {
        const result = parser.parse(
          withChildContext(currentContext, index, stateArray[index], parser),
        );

        if (result.success && result.consumed.length < 1) {
          const newStateArray = annotateFreshArray(
            currentContext.state,
            stateArray.map((state, idx) =>
              idx === index
                ? getAnnotatedChildState(
                  currentContext.state,
                  result.next.state,
                  parser,
                )
                : state
            ),
          );
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            state: newStateArray as readonly unknown[],
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };
          matchedParsers.add(index);
          foundMatch = true;
          break;
        } else if (!result.success && result.consumed < 1) {
          matchedParsers.add(index);
          foundMatch = true;
          break;
        }
      }
    }

    if (!foundMatch) {
      return {
        context: currentContext,
        failedParserIndexes,
      };
    }
  }

  return {
    context: currentContext,
    failedParserIndexes: [],
  };
}

async function advanceTupleSuggestContextAsync(
  context: ParserContext<readonly unknown[]>,
  parsers: readonly Parser<Mode, unknown, unknown>[],
): Promise<TupleSuggestAdvanceResult> {
  let currentContext = context;
  const matchedParsers = new Set<number>();

  while (
    currentContext.buffer.length > 0 && matchedParsers.size < parsers.length
  ) {
    let foundMatch = false;
    let failedParserIndexes: number[] = [];
    let deepestFailure = 0;
    const stateArray = Array.isArray(currentContext.state)
      ? [...currentContext.state]
      : parsers.map((parser) => parser.initialState);
    const remainingParsers = parsers
      .map((parser, index) => [parser, index] as const)
      .filter(([_, index]) => !matchedParsers.has(index))
      .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

    for (const [parser, index] of remainingParsers) {
      const result = await parser.parse(
        withChildContext(currentContext, index, stateArray[index], parser),
      );

      if (result.success && result.consumed.length > 0) {
        const newStateArray = annotateFreshArray(
          currentContext.state,
          stateArray.map((state, idx) =>
            idx === index
              ? getAnnotatedChildState(
                currentContext.state,
                result.next.state,
                parser,
              )
              : state
          ),
        );
        const mergedExec = mergeChildExec(
          currentContext.exec,
          result.next.exec,
        );
        currentContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newStateArray as readonly unknown[],
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        };
        matchedParsers.add(index);
        foundMatch = true;
        break;
      } else if (!result.success && result.consumed > 0) {
        if (result.consumed > deepestFailure) {
          deepestFailure = result.consumed;
          failedParserIndexes = [index];
        } else if (result.consumed === deepestFailure) {
          failedParserIndexes.push(index);
        }
      }
    }

    if (!foundMatch) {
      for (const [parser, index] of remainingParsers) {
        const result = await parser.parse(
          withChildContext(currentContext, index, stateArray[index], parser),
        );

        if (result.success && result.consumed.length < 1) {
          const newStateArray = annotateFreshArray(
            currentContext.state,
            stateArray.map((state, idx) =>
              idx === index
                ? getAnnotatedChildState(
                  currentContext.state,
                  result.next.state,
                  parser,
                )
                : state
            ),
          );
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            state: newStateArray as readonly unknown[],
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };
          matchedParsers.add(index);
          foundMatch = true;
          break;
        } else if (!result.success && result.consumed < 1) {
          matchedParsers.add(index);
          foundMatch = true;
          break;
        }
      }
    }

    if (!foundMatch) {
      return {
        context: currentContext,
        failedParserIndexes,
      };
    }
  }

  return {
    context: currentContext,
    failedParserIndexes: [],
  };
}

function markFailedTupleSuggestSources(
  parsers: readonly Parser<Mode, unknown, unknown>[],
  stateArray: readonly unknown[] | undefined,
  failedParserIndexes: readonly number[],
  runtime: ReturnType<typeof createDependencyRuntimeContext>,
  parentPath?: readonly PropertyKey[],
): void {
  if (failedParserIndexes.length < 1) return;
  const prefix = parentPath ?? [];

  for (const index of failedParserIndexes) {
    const parser = parsers[index];
    if (parser == null) continue;

    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[index]
      : parser.initialState;
    const nodes = getParserSuggestRuntimeNodes(
      parser,
      getAnnotatedChildState(stateArray, parserState, parser),
      [...prefix, index],
    );
    if (nodes.length < 1) continue;

    const failedRuntime = createDependencyRuntimeContext();
    collectExplicitSourceValues(nodes, failedRuntime);
    for (const node of nodes) {
      const sourceId = node.parser.dependencyMetadata?.source?.sourceId;
      if (sourceId != null && failedRuntime.isSourceFailed(sourceId)) {
        runtime.markSourceFailed(sourceId);
      }
    }
  }
}

async function markFailedTupleSuggestSourcesAsync(
  parsers: readonly Parser<Mode, unknown, unknown>[],
  stateArray: readonly unknown[] | undefined,
  failedParserIndexes: readonly number[],
  runtime: ReturnType<typeof createDependencyRuntimeContext>,
  parentPath?: readonly PropertyKey[],
): Promise<void> {
  if (failedParserIndexes.length < 1) return;
  const prefix = parentPath ?? [];

  for (const index of failedParserIndexes) {
    const parser = parsers[index];
    if (parser == null) continue;

    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[index]
      : parser.initialState;
    const nodes = getParserSuggestRuntimeNodes(
      parser,
      getAnnotatedChildState(stateArray, parserState, parser),
      [...prefix, index],
    );
    if (nodes.length < 1) continue;

    const failedRuntime = createDependencyRuntimeContext();
    await collectExplicitSourceValuesAsync(nodes, failedRuntime);
    for (const node of nodes) {
      const sourceId = node.parser.dependencyMetadata?.source?.sourceId;
      if (sourceId != null && failedRuntime.isSourceFailed(sourceId)) {
        runtime.markSourceFailed(sourceId);
      }
    }
  }
}

/**
 * Creates a parser that combines multiple parsers into a sequential tuple parser.
 * The parsers are applied in the order they appear in the array, and all must
 * succeed for the tuple parser to succeed.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @param options Optional configuration for the tuple parser.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 */
export function tuple<
  const T extends readonly Parser<Mode, unknown, unknown>[],
>(
  parsers: T,
  options?: TupleOptions,
): Parser<
  CombineTupleModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

/**
 * Creates a labeled parser that combines multiple parsers into a sequential
 * tuple parser with an associated label for documentation or error reporting.
 * @template T A readonly array type where each element is a {@link Parser}.
 * @param label A descriptive label for this parser group, used for
 *              documentation and error messages.
 * @param parsers An array of parsers that will be applied sequentially
 *                to create a tuple of their results.
 * @param options Optional configuration for the tuple parser.
 * @returns A {@link Parser} that produces a readonly tuple with the same length
 *          as the input array, where each element is the result of the
 *          corresponding parser.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 */
export function tuple<
  const T extends readonly Parser<Mode, unknown, unknown>[],
>(
  label: string,
  parsers: T,
  options?: TupleOptions,
): Parser<
  CombineTupleModes<T>,
  {
    readonly [K in keyof T]: T[K]["$valueType"][number] extends (infer U) ? U
      : never;
  },
  {
    readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U2) ? U2
      : never;
  }
>;

export function tuple<
  const T extends readonly Parser<Mode, unknown, unknown>[],
>(
  labelOrParsers: string | T,
  maybeParsersOrOptions?: T | TupleOptions,
  maybeOptions?: TupleOptions,
): Parser<
  Mode,
  { readonly [K in keyof T]: unknown },
  { readonly [K in keyof T]: unknown }
> {
  const label: string | undefined = typeof labelOrParsers === "string"
    ? labelOrParsers
    : undefined;
  if (label != null) validateLabel(label);

  let parsers: T;
  let options: TupleOptions = {};

  if (typeof labelOrParsers === "string") {
    // tuple(label, parsers) or tuple(label, parsers, options)
    parsers = maybeParsersOrOptions as T;
    options = maybeOptions ?? {};
  } else {
    // tuple(parsers) or tuple(parsers, options)
    parsers = labelOrParsers;
    options = (maybeParsersOrOptions as TupleOptions) ?? {};
  }

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  // Cast to sync parsers for suggest (suggest is always synchronous)
  const syncParsers = parsers as readonly Parser<"sync", unknown, unknown>[];

  // Check for duplicate option names at construction time unless explicitly allowed
  if (!options.allowDuplicates) {
    checkDuplicateOptionNames(
      parsers.map((parser, index) => [String(index), parser.usage] as const),
    );
  }

  type TupleState = { readonly [K in keyof T]: unknown };
  type ParseResult = ParserResult<TupleState>;

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<TupleState>,
  ): ParseResult => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Similar to object(), try parsers in priority order but maintain tuple semantics
    while (matchedParsers.size < syncParsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = syncParsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const result = parser.parse(
          withChildContext(currentContext, index, stateArray[index], parser),
        );

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = annotateFreshArray(
            currentContext.state,
            stateArray.map((s: unknown, idx: number) =>
              idx === index
                ? getAnnotatedChildState(
                  currentContext.state,
                  result.next.state,
                  parser,
                )
                : s
            ),
          );
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as TupleState,
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const result = parser.parse(
            withChildContext(currentContext, index, stateArray[index], parser),
          );

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = annotateFreshArray(
              currentContext.state,
              stateArray.map((s: unknown, idx: number) =>
                idx === index
                  ? getAnnotatedChildState(
                    currentContext.state,
                    result.next.state,
                    parser,
                  )
                  : s
              ),
            );
            const mergedExec = mergeChildExec(
              currentContext.exec,
              result.next.exec,
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as TupleState,
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<TupleState>,
  ): Promise<ParseResult> => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Similar to object(), try parsers in priority order but maintain tuple semantics
    while (matchedParsers.size < parsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = parsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const resultOrPromise = parser.parse(
          withChildContext(currentContext, index, stateArray[index], parser),
        );
        const result = await resultOrPromise;

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = annotateFreshArray(
            currentContext.state,
            stateArray.map((s: unknown, idx: number) =>
              idx === index
                ? getAnnotatedChildState(
                  currentContext.state,
                  result.next.state,
                  parser,
                )
                : s
            ),
          );
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as TupleState,
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const resultOrPromise = parser.parse(
            withChildContext(currentContext, index, stateArray[index], parser),
          );
          const result = await resultOrPromise;

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = annotateFreshArray(
              currentContext.state,
              stateArray.map((s: unknown, idx: number) =>
                idx === index
                  ? getAnnotatedChildState(
                    currentContext.state,
                    result.next.state,
                    parser,
                  )
                  : s
              ),
            );
            const mergedExec = mergeChildExec(
              currentContext.exec,
              result.next.exec,
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as TupleState,
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  const tupleParser = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    [fieldParsersKey]: parsers.map(
      (parser, index) =>
        [String(index), parser] as [
          string,
          Parser<Mode, unknown, unknown>,
        ],
    ),
    usage: parsers
      .toSorted((a, b) => b.priority - a.priority)
      .flatMap((p) => p.usage),
    leadingNames: sharedBufferLeadingNames(parsers),
    acceptingAnyToken: parsers.some((p) => p.acceptingAnyToken),
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    initialState: parsers.map((parser) => parser.initialState) as {
      readonly [K in keyof T]: T[K]["$stateType"][number] extends (infer U3)
        ? U3
        : never;
    },
    parse(context: ParserContext<TupleState>) {
      return dispatchByMode(
        combinedMode,
        () => parseSync(context),
        () => parseAsync(context),
      );
    },
    complete(state: TupleState, exec?: ExecutionContext) {
      return dispatchByMode(
        combinedMode,
        () => {
          const stateArray = state as unknown[];

          // Phase 1: Build dependency runtime and collect/fill source values.
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;

          // Phase 1: Pre-complete dependency sources (single evaluation).
          const tuplePairs = buildIndexedParserPairs(syncParsers);
          const tupleState = createAnnotatedArrayStateRecord(stateArray);
          const preCompleted = preCompleteAndRegisterDependencies(
            tupleState,
            tuplePairs,
            runtime.registry,
            childExec,
          );
          collectExplicitSourceValues(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromArray(syncParsers, stateArray, exec?.path),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;

          // Phase 2: Resolve all DeferredParseState in the state array.
          const resolvedArray = resolveStateWithRuntime(
            stateArray,
            runtime,
          ) as unknown[];

          // Phase 3: Complete each element using resolved state.
          // For pre-completed elements, reuse the Phase 1b result.
          const result: unknown[] = [];
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          for (let i = 0; i < syncParsers.length; i++) {
            const elementParser = syncParsers[i];

            let valueResult: import("./valueparser.ts").ValueParserResult<
              unknown
            >;
            const preCompletedResult = preCompleted.get(String(i));
            if (preCompletedResult !== undefined) {
              valueResult = unwrapCompleteResult(preCompletedResult);
            } else {
              const elementState = prepareStateForCompletion(
                resolvedArray[i],
                elementParser,
              );
              valueResult = unwrapCompleteResult(
                elementParser.complete(
                  elementState,
                  withChildExecPath(phase3Exec, i),
                ),
              );
            }
            if (valueResult.success) {
              result[i] = valueResult.value;
              if (valueResult.deferred) {
                if (valueResult.deferredKeys) {
                  deferredKeys.set(i, valueResult.deferredKeys);
                } else if (
                  valueResult.value == null ||
                  typeof valueResult.value !== "object"
                ) {
                  deferredKeys.set(i, null);
                } else {
                  hasDeferred = true;
                }
              }
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }

          const isDeferred = deferredKeys.size > 0 || hasDeferred;
          return {
            success: true as const,
            value: result as { [K in keyof T]: T[K]["$valueType"][number] },
            ...(isDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
        async () => {
          const stateArray = state as unknown[];

          // Phase 1: Build dependency runtime and pre-complete dependency
          // source parsers (single evaluation point for lazy defaults).
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const tuplePairs = buildIndexedParserPairs(parsers);
          const tupleState = createAnnotatedArrayStateRecord(stateArray);
          const preCompleted = await preCompleteAndRegisterDependenciesAsync(
            tupleState,
            tuplePairs,
            runtime.registry,
            childExec,
          );
          await collectExplicitSourceValuesAsync(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromArray(parsers, stateArray, exec?.path),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;

          // Phase 2: Resolve all DeferredParseState in the state array.
          const resolvedArray = await resolveStateWithRuntimeAsync(
            stateArray,
            runtime,
          ) as unknown[];

          // Phase 3: Complete each element using resolved state.
          // For pre-completed elements, reuse the Phase 1b result.
          const result: unknown[] = [];
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          for (let i = 0; i < parsers.length; i++) {
            const elementParser = parsers[i];

            let valueResult: import("./valueparser.ts").ValueParserResult<
              unknown
            >;
            const preCompletedResult = preCompleted.get(String(i));
            if (preCompletedResult !== undefined) {
              valueResult = unwrapCompleteResult(preCompletedResult);
            } else {
              const elementState = prepareStateForCompletion(
                resolvedArray[i],
                elementParser,
              );
              valueResult = unwrapCompleteResult(
                await elementParser.complete(
                  elementState,
                  withChildExecPath(phase3Exec, i),
                ),
              );
            }
            if (valueResult.success) {
              result[i] = valueResult.value;
              if (valueResult.deferred) {
                if (valueResult.deferredKeys) {
                  deferredKeys.set(i, valueResult.deferredKeys);
                } else if (
                  valueResult.value == null ||
                  typeof valueResult.value !== "object"
                ) {
                  deferredKeys.set(i, null);
                } else {
                  hasDeferred = true;
                }
              }
            } else {
              return { success: false as const, error: valueResult.error };
            }
          }

          const isDeferred = deferredKeys.size > 0 || hasDeferred;
          return {
            success: true as const,
            value: result as { [K in keyof T]: T[K]["$valueType"][number] },
            ...(isDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
      );
    },
    [extractPhase2SeedKey](state: TupleState, exec?: ExecutionContext) {
      return dispatchByMode(
        combinedMode,
        () => {
          const stateArray = state as unknown[];
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const tuplePairs = buildIndexedParserPairs(syncParsers);
          const tupleState = createAnnotatedArrayStateRecord(stateArray);
          const preCompleted = preCompleteAndRegisterDependencies(
            tupleState,
            tuplePairs,
            runtime.registry,
            childExec,
          );
          collectExplicitSourceValues(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromArray(syncParsers, stateArray, exec?.path),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;
          const resolvedArray = resolveStateWithRuntime(
            stateArray,
            runtime,
          ) as unknown[];

          const result: unknown[] = [];
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (let i = 0; i < syncParsers.length; i++) {
            const elementParser = syncParsers[i];
            const childExec = withChildExecPath(phase3Exec, i);
            const preCompletedResult = preCompleted.get(String(i));
            const seed = preCompletedResult !== undefined
              ? reusePreCompletedPhase2Seed(
                elementParser,
                prepareStateForCompletion(resolvedArray[i], elementParser),
                preCompletedResult,
                childExec,
              )
              : completeOrExtractPhase2Seed(
                elementParser,
                prepareStateForCompletion(resolvedArray[i], elementParser),
                childExec,
              );
            if (seed == null) continue;
            hasAnySeed = true;
            result[i] = seed.value;
            if (seed.deferred) {
              if (seed.deferredKeys) {
                deferredKeys.set(i, seed.deferredKeys);
              } else if (
                seed.value == null ||
                typeof seed.value !== "object"
              ) {
                deferredKeys.set(i, null);
              } else {
                hasDeferred = true;
              }
            }
          }

          if (!hasAnySeed) return null;
          return {
            value: result as { [K in keyof T]: T[K]["$valueType"][number] },
            ...(deferredKeys.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
        async () => {
          const stateArray = state as unknown[];
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const tuplePairs = buildIndexedParserPairs(parsers);
          const tupleState = createAnnotatedArrayStateRecord(stateArray);
          const preCompleted = await preCompleteAndRegisterDependenciesAsync(
            tupleState,
            tuplePairs,
            runtime.registry,
            childExec,
          );
          await collectExplicitSourceValuesAsync(
            filterPreCompletedRuntimeNodes(
              buildRuntimeNodesFromArray(parsers, stateArray, exec?.path),
              new Set(preCompleted.keys()),
            ),
            runtime,
          );
          const phase3Exec: ExecutionContext = {
            ...childExec,
            preCompletedByParser: undefined,
          } as ExecutionContext;
          const resolvedArray = await resolveStateWithRuntimeAsync(
            stateArray,
            runtime,
          ) as unknown[];

          const result: unknown[] = [];
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (let i = 0; i < parsers.length; i++) {
            const elementParser = parsers[i];
            const childExec = withChildExecPath(phase3Exec, i);
            const preCompletedResult = preCompleted.get(String(i));
            const seed = preCompletedResult !== undefined
              ? await reusePreCompletedPhase2SeedAsync(
                elementParser,
                prepareStateForCompletion(resolvedArray[i], elementParser),
                preCompletedResult,
                childExec,
              )
              : await completeOrExtractPhase2Seed(
                elementParser,
                prepareStateForCompletion(resolvedArray[i], elementParser),
                childExec,
              );
            if (seed == null) continue;
            hasAnySeed = true;
            result[i] = seed.value;
            if (seed.deferred) {
              if (seed.deferredKeys) {
                deferredKeys.set(i, seed.deferredKeys);
              } else if (
                seed.value == null ||
                typeof seed.value !== "object"
              ) {
                deferredKeys.set(i, null);
              } else {
                hasDeferred = true;
              }
            }
          }

          if (!hasAnySeed) return null;
          return {
            value: result as { [K in keyof T]: T[K]["$valueType"][number] },
            ...(deferredKeys.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
      );
    },
    suggest(
      context: ParserContext<TupleState>,
      prefix: string,
    ) {
      return dispatchIterableByMode(
        combinedMode,
        () => suggestTupleSync(context, prefix, syncParsers),
        () => suggestTupleAsync(context, prefix, parsers),
      );
    },
    getDocFragments(
      state: DocState<TupleState>,
      defaultValue?: TupleState,
    ) {
      const fragments = syncParsers.flatMap((p, i) => {
        const indexState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : {
            kind: "available",
            state: (state.state as readonly unknown[])[i],
          };
        return p.getDocFragments(indexState, defaultValue?.[i]).fragments;
      });
      const entries: DocEntry[] = fragments.filter((d) => d.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const section: DocSection = { title: label, entries };
      sections.push(section);
      return { fragments: sections.map((s) => ({ ...s, type: "section" })) };
    },
    [Symbol.for("Deno.customInspect")]() {
      const parsersStr = parsers.length === 1
        ? `[1 parser]`
        : `[${parsers.length} parsers]`;
      return label
        ? `tuple(${JSON.stringify(label)}, ${parsersStr})`
        : `tuple(${parsersStr})`;
    },
    // Type assertion needed because TypeScript cannot verify the combined mode
    // of multiple parsers at compile time. Runtime behavior is correct via mode dispatch.
  } as unknown as Parser<
    Mode,
    { readonly [K in keyof T]: unknown },
    { readonly [K in keyof T]: unknown }
  >;

  // Build composite normalizeValue from element parsers that have normalizers.
  const tupleNormalizers: [number, (v: unknown) => unknown][] = [];
  for (let i = 0; i < parsers.length; i++) {
    const p = parsers[i];
    if (typeof p.normalizeValue === "function") {
      tupleNormalizers.push([i, p.normalizeValue.bind(p)]);
    }
  }
  if (tupleNormalizers.length > 0) {
    type TupleType = { readonly [K in keyof T]: unknown };
    Object.defineProperty(tupleParser, "normalizeValue", {
      value(arr: TupleType): TupleType {
        if (!Array.isArray(arr)) return arr;
        let changed = false;
        let result: unknown[] | undefined;
        for (const [idx, normalize] of tupleNormalizers) {
          if (idx < arr.length && Object.hasOwn(arr, idx)) {
            try {
              const original = arr[idx];
              const normalized = normalize(original);
              if (normalized !== original) {
                if (!result) result = [...arr];
                result[idx] = normalized;
                changed = true;
              }
            } catch {
              // best-effort
            }
          }
        }
        return (changed ? result : arr) as TupleType;
      },
      configurable: true,
      enumerable: false,
    });
  }

  defineInheritedAnnotationParser(tupleParser);
  return tupleParser;
}

/**
 * Helper type to check if all members of a union are object-like.
 * This allows merge() to work with parsers like withDefault() that produce union types.
 */
type AllObjectLike<T> = T extends readonly unknown[] ? never
  : T extends Record<string | symbol, unknown> ? T
  : never;

/**
 * Helper type to extract object-like types from parser value types,
 * including union types where all members are objects.
 */
type ExtractObjectTypes<P> = P extends Parser<Mode, infer V, unknown>
  ? [AllObjectLike<V>] extends [never] ? never
  : V
  : never;

/**
 * Options for the {@link merge} parser.
 * @since 0.7.0
 */
export interface MergeOptions {
  /**
   * When `true`, allows duplicate option names across merged parsers.
   * By default (`false`), duplicate option names will cause a parse error.
   *
   * @default `false`
   * @since 0.7.0
   */
  readonly allowDuplicates?: boolean;

  /**
   * Controls visibility of all terms emitted by this merged parser.
   * @since 1.0.0
   */
  readonly hidden?: HiddenVisibility;
}

type MergeParserArity =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;
type MergeArityLimitError = {
  readonly __optiqueMergeArityLimit:
    "merge() requires between 1 and 15 parser arguments. Nest merge() to combine more.";
};
type MergeTailOptions = MergeOptions & { readonly $valueType?: never };
type MergeArityGuard<TParsers extends readonly unknown[]> =
  IsTuple<TParsers> extends true
    ? TParsers["length"] extends MergeParserArity ? unknown
    : MergeArityLimitError
    : unknown;
type MergeParsers = readonly Parser<Mode, unknown, unknown>[];
type EnsureMergeParsers<TParsers extends MergeParsers> = {
  readonly [K in keyof TParsers]: ExtractObjectTypes<TParsers[K]> extends never
    ? never
    : TParsers[K];
};
type IntersectMergeValues<TParsers extends MergeParsers> = TParsers extends
  readonly [
    infer THead extends Parser<Mode, unknown, unknown>,
    ...infer TRest extends MergeParsers,
  ] ? ExtractObjectTypes<THead> & IntersectMergeValues<TRest>
  : unknown;
type MergeValues<TParsers extends MergeParsers> = IsTuple<TParsers> extends true
  ? IntersectMergeValues<TParsers>
  : Record<string | symbol, unknown>;
type MergeReturnType<TParsers extends MergeParsers> = Parser<
  CombineModes<{ readonly [K in keyof TParsers]: ExtractMode<TParsers[K]> }>,
  MergeValues<TParsers>,
  Record<string | symbol, unknown>
>;

/**
 * Merges multiple object-like parsers into one parser, with options.
 *
 * This is useful for combining separate object parsers into one
 * unified parser while keeping fields grouped by parser boundaries.
 *
 * @param rest Parsers to merge, followed by merge options.
 * @returns A parser that merges parsed object fields from all parsers.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.7.0
 */
export function merge<const TParsers extends MergeParsers>(
  ...rest:
    & [...parsers: EnsureMergeParsers<TParsers>, options: MergeTailOptions]
    & MergeArityGuard<TParsers>
): MergeReturnType<TParsers>;

/**
 * Merges multiple object-like parsers into one labeled parser.
 *
 * This is useful for combining separate object parsers into one
 * unified parser while keeping fields grouped by parser boundaries.
 *
 * @param label Label used in documentation output.
 * @param parsers Parsers to merge in declaration order.
 * @returns A parser that merges parsed object fields from all parsers.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 * @since 0.4.0
 */
export function merge<const TParsers extends MergeParsers>(
  label: string,
  ...parsers: EnsureMergeParsers<TParsers> & MergeArityGuard<TParsers>
): MergeReturnType<TParsers>;

/**
 * Merges multiple object-like parsers into one labeled parser, with options.
 *
 * This is useful for combining separate object parsers into one
 * unified parser while keeping fields grouped by parser boundaries.
 *
 * @param label Label used in documentation output.
 * @param rest Parsers to merge, followed by merge options.
 * @returns A parser that merges parsed object fields from all parsers.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 * @since 0.7.0
 */
export function merge<const TParsers extends MergeParsers>(
  label: string,
  ...rest:
    & [...parsers: EnsureMergeParsers<TParsers>, options: MergeTailOptions]
    & MergeArityGuard<TParsers>
): MergeReturnType<TParsers>;

/**
 * Merges multiple object-like parsers into one parser.
 *
 * This is useful for combining separate object parsers into one
 * unified parser while keeping fields grouped by parser boundaries.
 *
 * @param parsers Parsers to merge in declaration order.
 * @returns A parser that merges parsed object fields from all parsers.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.1.0
 */
export function merge<const TParsers extends MergeParsers>(
  ...parsers: EnsureMergeParsers<TParsers> & MergeArityGuard<TParsers>
): MergeReturnType<TParsers>;

export function merge(
  ...args: readonly unknown[]
): Parser<
  Mode,
  Record<string | symbol, unknown>,
  Record<string | symbol, unknown>
> {
  // Check if first argument is a label
  const label = typeof args[0] === "string" ? args[0] : undefined;
  if (label != null) validateLabel(label);

  // Check if last argument is options
  const lastArg = args[args.length - 1];
  const hasOptions = lastArg != null &&
    typeof lastArg === "object" &&
    !("$valueType" in lastArg);
  const options: MergeOptions = hasOptions ? lastArg as MergeOptions : {};

  // Extract parsers (excluding label and options)
  const startIndex = typeof args[0] === "string" ? 1 : 0;
  const endIndex = hasOptions ? args.length - 1 : args.length;

  const rawParsers = args.slice(startIndex, endIndex) as Parser<
    Mode,
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[];

  if (rawParsers.length < 1) {
    throw new TypeError("merge() requires at least one parser argument.");
  }
  assertParsers(rawParsers, "merge()");

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = rawParsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for sync operations
  const syncRawParsers = rawParsers as Parser<
    "sync",
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >[];

  // Keep track of original indices before sorting
  const withIndex = rawParsers.map((p, i) => [p, i] as const);
  const sorted = withIndex.toSorted(([a], [b]) => b.priority - a.priority);
  const parsers = sorted.map(([p]) => p);

  // Sync parsers for sync operations
  const syncWithIndex = syncRawParsers.map((p, i) => [p, i] as const);
  const syncSorted = syncWithIndex.toSorted(([a], [b]) =>
    b.priority - a.priority
  );
  const syncParsers = syncSorted.map(([p]) => p);

  // Check for duplicate option names at construction time unless explicitly allowed
  if (!options.allowDuplicates) {
    checkDuplicateOptionNames(
      sorted.map(([parser, originalIndex]) =>
        [String(originalIndex), parser.usage] as const
      ),
    );
  }

  // Collect field parser pairs from all children so that nested merge()
  // can pre-complete dependency source fields at the outer level.
  const mergedFieldParsers = collectChildFieldParsers(parsers);
  const duplicateOutputFieldNames = collectDuplicateFieldNames(
    mergedFieldParsers,
  );
  const parserStateKey = (index: number) => `__parser_${index}`;
  const localObjectStateKey = (index: number) => `__merge_local_${index}`;
  const shouldPreserveLocalChildState = (
    parser: Parser<Mode, Record<string | symbol, unknown>, unknown>,
  ): boolean =>
    parser.initialState != null &&
    typeof parser.initialState === "object" &&
    Object.keys(parser.initialState).some((field) =>
      duplicateOutputFieldNames.has(field)
    );

  const initialState: Record<string | symbol, unknown> = {};
  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like withDefault(), or()),
      // include a __parser_N sentinel so that an outer merge's
      // extractParserState will forward these keys when extracting state
      // for this (inner) merge.
      initialState[parserStateKey(i)] = undefined;
    } else if (
      parser.initialState && typeof parser.initialState === "object"
    ) {
      for (const field in parser.initialState) {
        initialState[field] = parser.initialState[field];
      }
    }
  }
  type MergeState = Record<string | symbol, unknown>;
  type MergeParseResult = ParserResult<MergeState>;

  // Helper function to extract the appropriate state for a parser
  const extractParserState = (
    parser: Parser<Mode, MergeState, MergeState>,
    context: ParserContext<MergeState>,
    index: number,
  ): unknown => {
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like or()),
      // check if they have accumulated state during parsing
      const key = parserStateKey(index);
      if (
        context.state && typeof context.state === "object" &&
        key in context.state
      ) {
        return context.state[key];
      }
      return undefined;
    } else if (
      parser.initialState && typeof parser.initialState === "object"
    ) {
      const localStateKey = localObjectStateKey(index);
      if (
        shouldPreserveLocalChildState(parser) &&
        context.state && typeof context.state === "object" &&
        localStateKey in context.state
      ) {
        return context.state[localStateKey];
      }
      // For object parsers, extract matching fields from context state
      if (context.state && typeof context.state === "object") {
        const extractedState: MergeState = {};
        for (const field in parser.initialState) {
          extractedState[field] = field in context.state
            ? context.state[field]
            : parser.initialState[field];
        }
        return extractedState;
      }
      return parser.initialState;
    }
    return parser.initialState;
  };

  // Helper function to merge result state into context state
  const mergeResultState = (
    parser: Parser<Mode, MergeState, MergeState>,
    context: ParserContext<MergeState>,
    parserState: unknown,
    result: ParserResult<unknown>,
    index: number,
  ): MergeState => {
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like withDefault()),
      // store their state separately to avoid conflicts with object merging.
      const key = parserStateKey(index);
      if (result.success) {
        if (
          result.consumed.length > 0 || result.next.state !== undefined
        ) {
          return {
            ...context.state,
            [key]: result.next.state,
          };
        }
      }
      // Parser succeeded with zero consumption and undefined state
      return { ...context.state };
    }
    if (!result.success) return { ...context.state };

    const mergedState = {
      ...context.state,
      ...result.next.state as MergeState,
    };
    if (!shouldPreserveLocalChildState(parser)) {
      return mergedState;
    }
    if (
      result.consumed.length === 0 &&
      result.next.state === parserState
    ) {
      return mergedState;
    }
    return {
      ...mergedState,
      [localObjectStateKey(index)]: result.next.state,
    };
  };

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<MergeState>,
  ): MergeParseResult => {
    let currentContext = context;
    let zeroConsumedSuccess: {
      context: ParserContext<MergeState>;
      consumed: string[];
    } | null = null;

    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const parserState = extractParserState(parser, currentContext, i);

      const result = parser.parse(
        withChildContext(
          currentContext,
          i,
          parserState as Parameters<typeof parser.parse>[0]["state"],
          parser,
        ),
      );

      if (result.success) {
        const mergedExec = mergeChildExec(
          currentContext.exec,
          result.next.exec,
        );
        const newState = mergeResultState(
          parser,
          currentContext,
          parserState,
          result,
          i,
        );
        const newContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newState,
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        };

        if (result.consumed.length > 0) {
          return {
            success: true,
            next: newContext,
            consumed: result.consumed,
          };
        }

        currentContext = newContext;
        if (zeroConsumedSuccess === null) {
          zeroConsumedSuccess = { context: newContext, consumed: [] };
        } else {
          zeroConsumedSuccess.context = newContext;
        }
      } else if (result.consumed < 1) {
        continue;
      } else {
        return result as MergeParseResult;
      }
    }

    if (zeroConsumedSuccess !== null) {
      return {
        success: true,
        next: zeroConsumedSuccess.context,
        consumed: zeroConsumedSuccess.consumed,
      };
    }

    return {
      success: false,
      consumed: 0,
      error: message`No matching option or argument found.`,
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<MergeState>,
  ): Promise<MergeParseResult> => {
    let currentContext = context;
    let zeroConsumedSuccess: {
      context: ParserContext<MergeState>;
      consumed: string[];
    } | null = null;

    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const parserState = extractParserState(parser, currentContext, i);

      const resultOrPromise = parser.parse(
        withChildContext(
          currentContext,
          i,
          parserState as Parameters<typeof parser.parse>[0]["state"],
          parser,
        ),
      );
      const result = await resultOrPromise;

      if (result.success) {
        const mergedExec = mergeChildExec(
          currentContext.exec,
          result.next.exec,
        );
        const newState = mergeResultState(
          parser,
          currentContext,
          parserState,
          result,
          i,
        );
        const newContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newState,
          ...(mergedExec != null
            ? {
              exec: mergedExec,
              dependencyRegistry: mergedExec.dependencyRegistry,
            }
            : {}),
        };

        if (result.consumed.length > 0) {
          return {
            success: true,
            next: newContext,
            consumed: result.consumed,
          };
        }

        currentContext = newContext;
        if (zeroConsumedSuccess === null) {
          zeroConsumedSuccess = { context: newContext, consumed: [] };
        } else {
          zeroConsumedSuccess.context = newContext;
        }
      } else if (result.consumed < 1) {
        continue;
      } else {
        return result as MergeParseResult;
      }
    }

    if (zeroConsumedSuccess !== null) {
      return {
        success: true,
        next: zeroConsumedSuccess.context,
        consumed: zeroConsumedSuccess.consumed,
      };
    }

    return {
      success: false,
      consumed: 0,
      error: message`No matching option or argument found.`,
    };
  };

  const mergeParser = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    [fieldParsersKey]: mergedFieldParsers,
    priority: Math.max(...parsers.map((p) => p.priority)),
    usage: applyHiddenToUsage(
      parsers.flatMap((p) => p.usage),
      options.hidden,
    ),
    leadingNames: sharedBufferLeadingNames(parsers),
    acceptingAnyToken: parsers.some((p) => p.acceptingAnyToken),
    initialState,
    parse(context: ParserContext<MergeState>) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    complete(state: MergeState, exec?: ExecutionContext) {
      // Helper function to extract parser state for completion
      const extractCompleteState = (
        parser: Parser<Mode, MergeState, MergeState>,
        resolvedState: MergeState,
        index: number,
      ): unknown => {
        if (parser.initialState === undefined) {
          const key = parserStateKey(index);
          if (
            resolvedState && typeof resolvedState === "object" &&
            key in resolvedState
          ) {
            return resolvedState[key];
          }
          return undefined;
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          const key = localObjectStateKey(index);
          if (
            shouldPreserveLocalChildState(parser) &&
            resolvedState && typeof resolvedState === "object" &&
            key in resolvedState
          ) {
            return resolvedState[key];
          }
          if (resolvedState && typeof resolvedState === "object") {
            const extractedState: MergeState = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in resolvedState
                ? resolvedState[field]
                : parser.initialState[field];
            }
            // Preserve annotations from the merged state so that child
            // parsers (e.g., bindConfig) can access them during completion.
            const annotations = getAnnotations(resolvedState);
            if (annotations !== undefined) {
              return inheritAnnotations(resolvedState, extractedState);
            }
            return extractedState;
          }
          return parser.initialState;
        }
        return parser.initialState;
      };

      // For sync mode, complete synchronously
      if (!isAsync) {
        // Pre-complete dependency source fields from child parsers so that
        // env/config-backed dependency values are visible across merged
        // Phase 1: Build dependency runtime and pre-complete ALL dependency
        // source parsers (all 4 cases) via old-protocol bridge.
        const runtime = exec?.dependencyRuntime ??
          createDependencyRuntimeContext(exec?.dependencyRegistry);
        const childExec: ExecutionContext = {
          ...exec,
          dependencyRuntime: runtime,
        } as ExecutionContext;
        const duplicateFieldNames = collectDuplicateFieldNames(
          mergedFieldParsers,
        );
        const unambiguousFieldParsers = filterDuplicateFieldParsers(
          mergedFieldParsers,
        );
        // Pre-complete each child's dependency sources independently so
        // that branches with overlapping output keys do not collide in
        // the preCompleted map.  Only pass the cache to children whose
        // field pairs have unique keys (i.e., object() children).  Inner
        // merge children with duplicate keys must handle their own
        // pre-completion to avoid cross-branch result leaking.
        // https://github.com/dahlia/optique/issues/762
        type FieldPairs = ReadonlyArray<
          readonly [string | symbol, Parser<Mode, unknown, unknown>]
        >;
        const perChildPhase1 = syncParsers.map((parser, i) => {
          if (fieldParsersKey in parser) {
            const pairs = (parser as { [fieldParsersKey]: FieldPairs })[
              fieldParsersKey
            ];
            const excludedSourceFields = new Set(
              pairs
                .map(([field]) => field)
                .filter((field) => duplicateFieldNames.has(field)),
            );
            const phase1Pairs = filterExcludedFieldParsers(
              pairs,
              excludedSourceFields,
            );
            const preCompleted = preCompleteAndRegisterDependencies(
              state as Record<string | symbol, unknown>,
              phase1Pairs,
              runtime.registry,
              withChildExecPath(childExec, i),
            );
            // Only pass cache when field names are unique.  Inner merges
            // with duplicate output keys would collapse branch-specific
            // results in the flat map.
            return {
              cache: filterDuplicateKeys(preCompleted, phase1Pairs),
              excludedSourceFields: excludedSourceFields.size > 0
                ? excludedSourceFields
                : undefined,
            };
          }
          return { cache: undefined, excludedSourceFields: undefined };
        });
        collectExplicitSourceValues(
          buildRuntimeNodesFromPairs(
            unambiguousFieldParsers,
            state as Record<PropertyKey, unknown>,
            exec?.path,
          ),
          runtime,
        );

        // Phase 2: Resolve deferred parse states across the entire merged
        // state using the dependency runtime.
        const resolvedState = resolveStateWithRuntime(
          state,
          runtime,
        ) as MergeState;

        const object: MergeState = {};
        const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
        let hasDeferred = false;
        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = extractCompleteState(parser, resolvedState, i);
          const { cache, excludedSourceFields } = perChildPhase1[i];
          const childCompleteExec = withChildExecPath(childExec, i);
          // Keep duplicate-key exclusion at the merge level.  A child that
          // owns duplicate output keys still needs to seed its own local
          // dependency sources during completion, but those sources must not
          // leak into sibling completions through the shared merge runtime.
          const completeExec = excludedSourceFields == null
            ? {
              ...childCompleteExec,
              preCompletedByParser: cache,
            }
            : (() => {
              const childRuntime = createDependencyRuntimeContext(
                runtime.registry.clone(),
              );
              return {
                ...childCompleteExec,
                dependencyRuntime: childRuntime,
                dependencyRegistry: childRuntime.registry,
                preCompletedByParser: cache,
              };
            })();
          const result = unwrapCompleteResult(
            parser.complete(
              parserState as Parameters<typeof parser.complete>[0],
              completeExec as ExecutionContext,
            ),
          );
          if (!result.success) return result;
          const resultValue = result.value as MergeState;
          for (const field in resultValue) {
            object[field] = resultValue[field];
            // When a later child overwrites a key that an earlier child
            // marked as deferred, clear the stale marker so that
            // prepareParsedForContexts() does not strip the real value.
            if (
              deferredKeys.has(field) &&
              !(result.deferred && result.deferredKeys?.has(field))
            ) {
              deferredKeys.delete(field);
            }
          }
          if (result.deferred && result.deferredKeys) {
            for (const [key, value] of result.deferredKeys) {
              deferredKeys.set(key, value);
            }
          } else if (result.deferred) {
            // Child is deferred but lacks per-field info (e.g., after
            // map()).  We cannot determine which of its fields are
            // deferred, so let them pass through.
            hasDeferred = true;
          }
        }
        const isDeferred = deferredKeys.size > 0 || hasDeferred;
        return {
          success: true as const,
          value: object,
          ...(isDeferred
            ? {
              deferred: true as const,
              ...(deferredKeys.size > 0
                ? { deferredKeys: deferredKeys as DeferredMap }
                : {}),
            }
            : {}),
        };
      }

      // For async mode, complete asynchronously
      return (async () => {
        // Phase 1: Build dependency runtime and pre-complete ALL dependency
        // source parsers (all 4 cases) via old-protocol bridge.
        const runtime = exec?.dependencyRuntime ??
          createDependencyRuntimeContext(exec?.dependencyRegistry);
        const childExec: ExecutionContext = {
          ...exec,
          dependencyRuntime: runtime,
        } as ExecutionContext;
        const duplicateFieldNames = collectDuplicateFieldNames(
          mergedFieldParsers,
        );
        const unambiguousFieldParsers = filterDuplicateFieldParsers(
          mergedFieldParsers,
        );
        type AsyncFieldPairs = ReadonlyArray<
          readonly [string | symbol, Parser<Mode, unknown, unknown>]
        >;
        const perChildPhase1: {
          readonly cache?: ReadonlyMap<string | symbol, unknown>;
          readonly excludedSourceFields?: ReadonlySet<string | symbol>;
        }[] = [];
        for (let i = 0; i < parsers.length; i++) {
          const parser = parsers[i];
          if (fieldParsersKey in parser) {
            const pairs = (parser as { [fieldParsersKey]: AsyncFieldPairs })[
              fieldParsersKey
            ];
            const excludedSourceFields = new Set(
              pairs
                .map(([field]) => field)
                .filter((field) => duplicateFieldNames.has(field)),
            );
            const phase1Pairs = filterExcludedFieldParsers(
              pairs,
              excludedSourceFields,
            );
            const preCompleted = await preCompleteAndRegisterDependenciesAsync(
              state as Record<string | symbol, unknown>,
              phase1Pairs,
              runtime.registry,
              withChildExecPath(childExec, i),
            );
            perChildPhase1.push({
              cache: filterDuplicateKeys(preCompleted, phase1Pairs),
              excludedSourceFields: excludedSourceFields.size > 0
                ? excludedSourceFields
                : undefined,
            });
          } else {
            perChildPhase1.push({
              cache: undefined,
              excludedSourceFields: undefined,
            });
          }
        }
        await collectExplicitSourceValuesAsync(
          buildRuntimeNodesFromPairs(
            unambiguousFieldParsers,
            state as Record<PropertyKey, unknown>,
            exec?.path,
          ),
          runtime,
        );

        // Phase 2: Resolve deferred parse states across the entire merged
        // state using the dependency runtime.
        const resolvedState = await resolveStateWithRuntimeAsync(
          state,
          runtime,
        ) as MergeState;

        const object: MergeState = {};
        const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
        let hasDeferred = false;
        for (let i = 0; i < parsers.length; i++) {
          const parser = parsers[i];
          const parserState = extractCompleteState(parser, resolvedState, i);
          const { cache: asyncCache, excludedSourceFields } = perChildPhase1[i];
          const childCompleteExec = withChildExecPath(childExec, i);
          const completeExec = excludedSourceFields == null
            ? {
              ...childCompleteExec,
              preCompletedByParser: asyncCache,
            }
            : (() => {
              const childRuntime = createDependencyRuntimeContext(
                runtime.registry.clone(),
              );
              return {
                ...childCompleteExec,
                dependencyRuntime: childRuntime,
                dependencyRegistry: childRuntime.registry,
                preCompletedByParser: asyncCache,
              };
            })();
          const result = unwrapCompleteResult(
            await parser.complete(
              parserState as Parameters<typeof parser.complete>[0],
              completeExec as ExecutionContext,
            ),
          );
          if (!result.success) return result;
          const resultValue = result.value as MergeState;
          for (const field in resultValue) {
            object[field] = resultValue[field];
            // When a later child overwrites a key that an earlier child
            // marked as deferred, clear the stale marker so that
            // prepareParsedForContexts() does not strip the real value.
            if (
              deferredKeys.has(field) &&
              !(result.deferred && result.deferredKeys?.has(field))
            ) {
              deferredKeys.delete(field);
            }
          }
          if (result.deferred && result.deferredKeys) {
            for (const [key, value] of result.deferredKeys) {
              deferredKeys.set(key, value);
            }
          } else if (result.deferred) {
            // Child is deferred but lacks per-field info (e.g., after
            // map()).  We cannot determine which of its fields are
            // deferred, so let them pass through.
            hasDeferred = true;
          }
        }
        const isDeferred = deferredKeys.size > 0 || hasDeferred;
        return {
          success: true as const,
          value: object,
          ...(isDeferred
            ? {
              deferred: true as const,
              ...(deferredKeys.size > 0
                ? { deferredKeys: deferredKeys as DeferredMap }
                : {}),
            }
            : {}),
        };
      })();
    },
    [extractPhase2SeedKey](state: MergeState, exec?: ExecutionContext) {
      const extractMergeCompleteState = (
        parser: Parser<Mode, MergeState, MergeState>,
        resolvedState: MergeState,
        index: number,
      ): unknown => {
        if (parser.initialState === undefined) {
          const key = parserStateKey(index);
          if (
            resolvedState && typeof resolvedState === "object" &&
            key in resolvedState
          ) {
            return resolvedState[key];
          }
          return undefined;
        } else if (
          parser.initialState && typeof parser.initialState === "object"
        ) {
          const key = localObjectStateKey(index);
          if (
            shouldPreserveLocalChildState(parser) &&
            resolvedState && typeof resolvedState === "object" &&
            key in resolvedState
          ) {
            return resolvedState[key];
          }
          if (resolvedState && typeof resolvedState === "object") {
            const extractedState: MergeState = {};
            for (const field in parser.initialState) {
              extractedState[field] = field in resolvedState
                ? resolvedState[field]
                : parser.initialState[field];
            }
            return inheritAnnotations(resolvedState, extractedState);
          }
          return parser.initialState;
        }
        return parser.initialState;
      };
      return dispatchByMode(
        combinedMode,
        () => {
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const duplicateFieldNames = collectDuplicateFieldNames(
            mergedFieldParsers,
          );
          const unambiguousFieldParsers = filterDuplicateFieldParsers(
            mergedFieldParsers,
          );
          type FieldPairs = ReadonlyArray<
            readonly [string | symbol, Parser<Mode, unknown, unknown>]
          >;
          const perChildPhase1 = syncParsers.map((parser, i) => {
            if (fieldParsersKey in parser) {
              const pairs = (parser as { [fieldParsersKey]: FieldPairs })[
                fieldParsersKey
              ];
              const excludedSourceFields = new Set(
                pairs
                  .map(([field]) => field)
                  .filter((field) => duplicateFieldNames.has(field)),
              );
              const phase1Pairs = filterExcludedFieldParsers(
                pairs,
                excludedSourceFields,
              );
              const preCompleted = preCompleteAndRegisterDependencies(
                state as Record<string | symbol, unknown>,
                phase1Pairs,
                runtime.registry,
                withChildExecPath(childExec, i),
              );
              return {
                cache: filterDuplicateKeys(preCompleted, phase1Pairs),
                excludedSourceFields: excludedSourceFields.size > 0
                  ? excludedSourceFields
                  : undefined,
              };
            }
            return { cache: undefined, excludedSourceFields: undefined };
          });
          collectExplicitSourceValues(
            buildRuntimeNodesFromPairs(
              unambiguousFieldParsers,
              state as Record<PropertyKey, unknown>,
              exec?.path,
            ),
            runtime,
          );
          const resolvedState = resolveStateWithRuntime(
            state,
            runtime,
          ) as MergeState;

          const object: MergeState = {};
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (let i = 0; i < syncParsers.length; i++) {
            const parser = syncParsers[i];
            const parserState = extractMergeCompleteState(
              parser,
              resolvedState,
              i,
            );
            const { cache, excludedSourceFields } = perChildPhase1[i];
            const childCompleteExec = withChildExecPath(childExec, i);
            const completeExec = excludedSourceFields == null
              ? {
                ...childCompleteExec,
                preCompletedByParser: cache,
              }
              : (() => {
                const childRuntime = createDependencyRuntimeContext(
                  runtime.registry.clone(),
                );
                return {
                  ...childCompleteExec,
                  dependencyRuntime: childRuntime,
                  dependencyRegistry: childRuntime.registry,
                  preCompletedByParser: cache,
                };
              })();
            const seed = completeOrExtractPhase2Seed(
              parser,
              parserState as Parameters<typeof parser.complete>[0],
              completeExec as ExecutionContext,
            );
            if (seed == null) continue;
            hasAnySeed = true;
            const seedValue = seed.value as MergeState;
            for (const field in seedValue) {
              object[field] = seedValue[field];
              if (
                deferredKeys.has(field) &&
                !(seed.deferred && seed.deferredKeys?.has(field))
              ) {
                deferredKeys.delete(field);
              }
            }
            if (seed.deferred && seed.deferredKeys) {
              for (const [key, value] of seed.deferredKeys) {
                deferredKeys.set(key, value);
              }
            } else if (seed.deferred) {
              hasDeferred = true;
            }
          }

          if (!hasAnySeed) return null;
          return {
            value: object,
            ...(deferredKeys.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
        async () => {
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const duplicateFieldNames = collectDuplicateFieldNames(
            mergedFieldParsers,
          );
          const unambiguousFieldParsers = filterDuplicateFieldParsers(
            mergedFieldParsers,
          );
          type AsyncFieldPairs = ReadonlyArray<
            readonly [string | symbol, Parser<Mode, unknown, unknown>]
          >;
          const perChildPhase1: {
            readonly cache?: ReadonlyMap<string | symbol, unknown>;
            readonly excludedSourceFields?: ReadonlySet<string | symbol>;
          }[] = [];
          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            if (fieldParsersKey in parser) {
              const pairs = (parser as { [fieldParsersKey]: AsyncFieldPairs })[
                fieldParsersKey
              ];
              const excludedSourceFields = new Set(
                pairs
                  .map(([field]) => field)
                  .filter((field) => duplicateFieldNames.has(field)),
              );
              const phase1Pairs = filterExcludedFieldParsers(
                pairs,
                excludedSourceFields,
              );
              const preCompleted =
                await preCompleteAndRegisterDependenciesAsync(
                  state as Record<string | symbol, unknown>,
                  phase1Pairs,
                  runtime.registry,
                  withChildExecPath(childExec, i),
                );
              perChildPhase1.push({
                cache: filterDuplicateKeys(preCompleted, phase1Pairs),
                excludedSourceFields: excludedSourceFields.size > 0
                  ? excludedSourceFields
                  : undefined,
              });
            } else {
              perChildPhase1.push({
                cache: undefined,
                excludedSourceFields: undefined,
              });
            }
          }
          await collectExplicitSourceValuesAsync(
            buildRuntimeNodesFromPairs(
              unambiguousFieldParsers,
              state as Record<PropertyKey, unknown>,
              exec?.path,
            ),
            runtime,
          );
          const resolvedState = await resolveStateWithRuntimeAsync(
            state,
            runtime,
          ) as MergeState;

          const object: MergeState = {};
          const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
          let hasDeferred = false;
          let hasAnySeed = false;
          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserState = extractMergeCompleteState(
              parser,
              resolvedState,
              i,
            );
            const { cache: asyncCache, excludedSourceFields } = perChildPhase1[
              i
            ];
            const childCompleteExec = withChildExecPath(childExec, i);
            const completeExec = excludedSourceFields == null
              ? {
                ...childCompleteExec,
                preCompletedByParser: asyncCache,
              }
              : (() => {
                const childRuntime = createDependencyRuntimeContext(
                  runtime.registry.clone(),
                );
                return {
                  ...childCompleteExec,
                  dependencyRuntime: childRuntime,
                  dependencyRegistry: childRuntime.registry,
                  preCompletedByParser: asyncCache,
                };
              })();
            const seed = await completeOrExtractPhase2Seed(
              parser,
              parserState as Parameters<typeof parser.complete>[0],
              completeExec as ExecutionContext,
            );
            if (seed == null) continue;
            hasAnySeed = true;
            const seedValue = seed.value as MergeState;
            for (const field in seedValue) {
              object[field] = seedValue[field];
              if (
                deferredKeys.has(field) &&
                !(seed.deferred && seed.deferredKeys?.has(field))
              ) {
                deferredKeys.delete(field);
              }
            }
            if (seed.deferred && seed.deferredKeys) {
              for (const [key, value] of seed.deferredKeys) {
                deferredKeys.set(key, value);
              }
            } else if (seed.deferred) {
              hasDeferred = true;
            }
          }

          if (!hasAnySeed) return null;
          return {
            value: object,
            ...(deferredKeys.size > 0 || hasDeferred
              ? {
                deferred: true as const,
                ...(deferredKeys.size > 0
                  ? { deferredKeys: deferredKeys as DeferredMap }
                  : {}),
              }
              : {}),
          };
        },
      );
    },
    suggest(
      context: ParserContext<MergeState>,
      prefix: string,
    ) {
      if (options.hidden === true) {
        return dispatchIterableByMode(
          combinedMode,
          function* () {},
          async function* () {},
        );
      }
      // Helper to extract parser state for a given index
      const extractState = (
        p: Parser<Mode, Record<string | symbol, unknown>, unknown>,
        i: number,
      ): unknown => {
        if (p.initialState === undefined) {
          const key = parserStateKey(i);
          if (
            context.state && typeof context.state === "object" &&
            key in context.state
          ) {
            return context.state[key];
          }
          return undefined;
        } else if (
          p.initialState && typeof p.initialState === "object"
        ) {
          const key = localObjectStateKey(i);
          if (
            shouldPreserveLocalChildState(p) &&
            context.state && typeof context.state === "object" &&
            key in context.state
          ) {
            return context.state[key];
          }
          if (context.state && typeof context.state === "object") {
            const extractedState: MergeState = {};
            for (const field in p.initialState) {
              extractedState[field] = field in context.state
                ? context.state[field]
                : (p.initialState as Record<string, unknown>)[field];
            }
            return extractedState;
          }
          return p.initialState;
        }
        return p.initialState;
      };

      if (isAsync) {
        return (async function* () {
          // Build dependency runtime via metadata.
          const runtime = createDependencyRuntimeContext(
            context.dependencyRegistry?.clone(),
          );
          const mergedPairs = collectChildFieldParsers(parsers);
          const duplicateFieldNames = collectDuplicateFieldNames(mergedPairs);
          const childFieldPairs = filterDuplicateFieldParsers(
            mergedPairs,
          );
          const perChildExcludedSourceFields = parsers.map((parser) => {
            if (!(fieldParsersKey in parser)) return undefined;
            const pairs = (parser as {
              [fieldParsersKey]: ReadonlyArray<
                readonly [string | symbol, Parser<Mode, unknown, unknown>]
              >;
            })[fieldParsersKey];
            const excludedSourceFields = new Set(
              pairs
                .map(([field]) => field)
                .filter((field) => duplicateFieldNames.has(field)),
            );
            return excludedSourceFields.size > 0
              ? excludedSourceFields
              : undefined;
          });
          if (context.state && typeof context.state === "object") {
            await collectExplicitSourceValuesAsync(
              buildRuntimeNodesFromPairs(
                childFieldPairs,
                context.state as Record<PropertyKey, unknown>,
                context.exec?.path,
              ),
              runtime,
            );
          }
          if (context.state && typeof context.state === "object") {
            collectSourcesFromState(
              context.state,
              runtime,
              new WeakSet<object>(),
              duplicateFieldNames,
            );
          }
          await completeDependencySourceDefaultsAsync(
            context,
            childFieldPairs,
            runtime.registry,
            context.exec,
          );
          const contextWithRegistry = {
            ...context,
            dependencyRegistry: runtime.registry,
          };

          const suggestions: Suggestion[] = [];

          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserState = extractState(parser, i);
            const childContext = withChildContext(
              contextWithRegistry,
              i,
              parserState as Parameters<typeof parser.suggest>[0]["state"],
              parser,
            );
            const excludedSourceFields = perChildExcludedSourceFields[i];
            const contextForChild = excludedSourceFields == null
              ? childContext
              : (() => {
                const childRuntime = createDependencyRuntimeContext(
                  runtime.registry.clone(),
                );
                return {
                  ...childContext,
                  dependencyRegistry: childRuntime.registry,
                  exec: childContext.exec == null ? childContext.exec : {
                    ...childContext.exec,
                    dependencyRegistry: childRuntime.registry,
                  },
                };
              })();

            const parserSuggestions = parser.suggest(
              contextForChild,
              prefix,
            );

            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }

          yield* deduplicateSuggestions(suggestions);
        })();
      }

      // Build dependency runtime via metadata.
      const runtime = createDependencyRuntimeContext(
        context.dependencyRegistry?.clone(),
      );
      const mergedPairs = collectChildFieldParsers(syncParsers);
      const duplicateFieldNames = collectDuplicateFieldNames(mergedPairs);
      const childFieldPairs = filterDuplicateFieldParsers(
        mergedPairs,
      );
      const perChildExcludedSourceFields = syncParsers.map((parser) => {
        if (!(fieldParsersKey in parser)) return undefined;
        const pairs = (parser as {
          [fieldParsersKey]: ReadonlyArray<
            readonly [string | symbol, Parser<Mode, unknown, unknown>]
          >;
        })[fieldParsersKey];
        const excludedSourceFields = new Set(
          pairs
            .map(([field]) => field)
            .filter((field) => duplicateFieldNames.has(field)),
        );
        return excludedSourceFields.size > 0 ? excludedSourceFields : undefined;
      });
      if (context.state && typeof context.state === "object") {
        collectExplicitSourceValues(
          buildRuntimeNodesFromPairs(
            childFieldPairs,
            context.state as Record<PropertyKey, unknown>,
            context.exec?.path,
          ),
          runtime,
        );
      }
      if (context.state && typeof context.state === "object") {
        collectSourcesFromState(
          context.state,
          runtime,
          new WeakSet<object>(),
          duplicateFieldNames,
        );
      }
      completeDependencySourceDefaults(
        context,
        childFieldPairs,
        runtime.registry,
        context.exec,
      );
      const contextWithRegistry = {
        ...context,
        dependencyRegistry: runtime.registry,
      };

      return (function* () {
        const suggestions: Suggestion[] = [];

        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = extractState(parser, i);
          const childContext = withChildContext(
            contextWithRegistry,
            i,
            parserState as Parameters<typeof parser.suggest>[0]["state"],
            parser,
          );
          const excludedSourceFields = perChildExcludedSourceFields[i];
          const contextForChild = excludedSourceFields == null
            ? childContext
            : (() => {
              const childRuntime = createDependencyRuntimeContext(
                runtime.registry.clone(),
              );
              return {
                ...childContext,
                dependencyRegistry: childRuntime.registry,
                exec: childContext.exec == null ? childContext.exec : {
                  ...childContext.exec,
                  dependencyRegistry: childRuntime.registry,
                },
              };
            })();

          const parserSuggestions = parser.suggest(
            contextForChild,
            prefix,
          );

          suggestions.push(...parserSuggestions);
        }

        yield* deduplicateSuggestions(suggestions);
      })();
    },
    getDocFragments(
      state: DocState<Record<string | symbol, unknown>>,
      _defaultValue?: unknown,
    ) {
      let brief: Message | undefined;
      let description: Message | undefined;
      let footer: Message | undefined;
      const fragments = parsers.flatMap((p, i) => {
        let parserState: DocState<unknown>;

        if (p.initialState === undefined) {
          // For parsers with undefined initialState (like or()),
          // check if they have accumulated state during parsing
          const key = `__parser_${i}`;
          if (
            state.kind === "available" &&
            state.state &&
            typeof state.state === "object" &&
            key in state.state
          ) {
            parserState = {
              kind: "available",
              state: (state.state as Record<string | symbol, unknown>)[key],
            };
          } else {
            parserState = { kind: "unavailable" };
          }
        } else {
          // If parser has defined initialState (like object()),
          // pass the available state directly as it shares the merged state object
          parserState = state.kind === "unavailable"
            ? { kind: "unavailable" }
            : { kind: "available", state: state.state };
        }

        // Cast parserState because the generic type constraints on p.getDocFragments
        // are strictly typed to the parser's expected state, but here we are dealing with
        // a state value extracted from a heterogeneous merged state object.
        const docFragments = p.getDocFragments(
          parserState as DocState<Record<string | symbol, unknown>>,
          undefined,
        );
        brief ??= docFragments.brief;
        description ??= docFragments.description;
        footer ??= docFragments.footer;
        return docFragments.fragments;
      });
      const hiddenAwareFragments = applyHiddenToDocFragments(
        fragments,
        options.hidden,
      );
      const entries: DocEntry[] = hiddenAwareFragments.filter((f) =>
        f.type === "entry"
      );
      const sections: DocSection[] = [];
      for (const fragment of hiddenAwareFragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }

      // If label is provided, wrap all content in a labeled section
      if (label) {
        const labeledSection: DocSection = { title: label, entries };
        sections.push(labeledSection);
        return {
          brief,
          description,
          footer,
          fragments: sections.map<DocFragment>((s) => ({
            ...s,
            type: "section",
          })),
        };
      }

      return {
        brief,
        description,
        footer,
        fragments: [
          ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
          { type: "section", entries },
        ],
      };
    },
  } as Parser<
    Mode,
    Record<string | symbol, unknown>,
    Record<string | symbol, unknown>
  >;

  // merge() does NOT forward normalizeValue because children may have
  // overlapping keys with last-write-wins semantics.  Normalizing through
  // an earlier child's normalizer would change keys owned by a later child.
  // The same reasoning applies to validateValue (#414): composite-key
  // ownership cannot be resolved from the value alone.
  defineInheritedAnnotationParser(mergeParser);
  return mergeParser;
}

type ConcatParserArity =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;
type ConcatArityLimitError = {
  readonly __optiqueConcatArityLimit:
    "concat() requires between 1 and 15 parser arguments. Nest concat() to combine more.";
};
type ConcatParsers = readonly Parser<Mode, readonly unknown[], unknown>[];
type ConcatArityGuard<TParsers extends readonly unknown[]> =
  IsTuple<TParsers> extends true
    ? TParsers["length"] extends ConcatParserArity ? unknown
    : ConcatArityLimitError
    : unknown;
type ConcatStates<TParsers extends ConcatParsers> = {
  [K in keyof TParsers]: TParsers[K] extends Parser<
    Mode,
    readonly unknown[],
    infer TState
  > ? TState
    : never;
};
type ConcatTupleValues<TParsers extends ConcatParsers> = TParsers extends
  readonly [
    Parser<Mode, infer THead extends readonly unknown[], unknown>,
    ...infer TRest extends ConcatParsers,
  ] ? [...THead, ...ConcatTupleValues<TRest>]
  : [];
type ConcatValues<TParsers extends ConcatParsers> = IsTuple<TParsers> extends
  true ? ConcatTupleValues<TParsers>
  : readonly unknown[];

/**
 * Builds a dependency registry from the pre-parsed context state and returns
 * the enriched context alongside the state array.  Used by both the sync and
 * async branches of `concat().suggest()`.
 * @internal
 */
function buildSuggestRegistry(
  preParsedContext: ParserContext<readonly unknown[]>,
  parsers: readonly Parser<"sync", readonly unknown[], unknown>[],
): {
  context: ParserContext<readonly unknown[]>;
  stateArray: unknown[] | undefined;
} {
  const stateArray = preParsedContext.state as unknown[] | undefined;
  const runtime = createDependencyRuntimeContext(
    preParsedContext.dependencyRegistry?.clone(),
  );
  if (stateArray && Array.isArray(stateArray)) {
    const nodes = buildSuggestRuntimeNodesFromArray(
      parsers,
      stateArray,
      preParsedContext.exec?.path,
    );
    collectExplicitSourceValues(
      nodes,
      runtime,
    );
    fillMissingSourceDefaults(nodes, runtime);
    collectSourcesFromState(stateArray, runtime);
    completeDependencySourceDefaults(
      {
        ...preParsedContext,
        state: createAnnotatedArrayStateRecord(stateArray),
      },
      buildIndexedParserPairs(parsers),
      runtime.registry,
      preParsedContext.exec,
    );
    const prefix = preParsedContext.exec?.path ?? [];
    for (let i = 0; i < parsers.length; i++) {
      seedSuggestRuntimeFromFieldParsers(
        parsers[i],
        getAnnotatedChildState(stateArray, stateArray[i], parsers[i]),
        runtime,
        [...prefix, i],
      );
    }
  }
  return {
    context: {
      ...preParsedContext,
      dependencyRegistry: runtime.registry,
      ...(preParsedContext.exec != null
        ? {
          exec: {
            ...preParsedContext.exec,
            dependencyRuntime: runtime,
            dependencyRegistry: runtime.registry,
          },
        }
        : {}),
    },
    stateArray,
  };
}

async function buildSuggestRegistryAsync(
  preParsedContext: ParserContext<readonly unknown[]>,
  parsers: readonly Parser<Mode, readonly unknown[], unknown>[],
): Promise<{
  context: ParserContext<readonly unknown[]>;
  stateArray: unknown[] | undefined;
}> {
  const stateArray = preParsedContext.state as unknown[] | undefined;
  const runtime = createDependencyRuntimeContext(
    preParsedContext.dependencyRegistry?.clone(),
  );
  if (stateArray && Array.isArray(stateArray)) {
    const nodes = buildSuggestRuntimeNodesFromArray(
      parsers,
      stateArray,
      preParsedContext.exec?.path,
    );
    await collectExplicitSourceValuesAsync(
      nodes,
      runtime,
    );
    await fillMissingSourceDefaultsAsync(nodes, runtime);
    collectSourcesFromState(stateArray, runtime);
    await completeDependencySourceDefaultsAsync(
      {
        ...preParsedContext,
        state: createAnnotatedArrayStateRecord(stateArray),
      },
      buildIndexedParserPairs(parsers),
      runtime.registry,
      preParsedContext.exec,
    );
    const prefix = preParsedContext.exec?.path ?? [];
    for (let i = 0; i < parsers.length; i++) {
      await seedSuggestRuntimeFromFieldParsersAsync(
        parsers[i],
        getAnnotatedChildState(stateArray, stateArray[i], parsers[i]),
        runtime,
        [...prefix, i],
      );
    }
  }
  return {
    context: {
      ...preParsedContext,
      dependencyRegistry: runtime.registry,
      ...(preParsedContext.exec != null
        ? {
          exec: {
            ...preParsedContext.exec,
            dependencyRuntime: runtime,
            dependencyRegistry: runtime.registry,
          },
        }
        : {}),
    },
    stateArray,
  };
}

function seedSuggestRuntimeFromFieldParsers(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
  runtime: ReturnType<typeof createDependencyRuntimeContext>,
  parentPath: readonly PropertyKey[],
): void {
  if (!(fieldParsersKey in parser)) return;
  const rawPairs = (parser as {
    [fieldParsersKey]: ReadonlyArray<
      readonly [string | symbol, Parser<Mode, unknown, unknown>]
    >;
  })[fieldParsersKey];
  const duplicateFieldNames = collectDuplicateFieldNames(rawPairs);
  const pairs = filterDuplicateFieldParsers(
    rawPairs,
  );
  const stateRecord = state != null && typeof state === "object"
    ? state as Record<PropertyKey, unknown>
    : {};
  const nodes = buildSuggestRuntimeNodesFromPairs(
    pairs,
    stateRecord,
    parentPath,
  );
  collectExplicitSourceValues(nodes, runtime);
  fillMissingSourceDefaults(nodes, runtime);
  collectSourcesFromState(
    state,
    runtime,
    new WeakSet<object>(),
    duplicateFieldNames,
  );
  completeDependencySourceDefaults(
    {
      buffer: [],
      optionsTerminated: false,
      state: stateRecord,
      usage: parser.usage,
      dependencyRegistry: runtime.registry,
      exec: {
        usage: parser.usage,
        phase: "suggest",
        path: parentPath,
        dependencyRuntime: runtime,
        dependencyRegistry: runtime.registry,
      },
    },
    pairs,
    runtime.registry,
    {
      usage: parser.usage,
      phase: "suggest",
      path: parentPath,
      dependencyRuntime: runtime,
      dependencyRegistry: runtime.registry,
    },
  );
  for (const [field, childParser] of pairs) {
    seedSuggestRuntimeFromFieldParsers(
      childParser,
      getAnnotatedFieldState(stateRecord, field, childParser),
      runtime,
      [...parentPath, field],
    );
  }
}

async function seedSuggestRuntimeFromFieldParsersAsync(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
  runtime: ReturnType<typeof createDependencyRuntimeContext>,
  parentPath: readonly PropertyKey[],
): Promise<void> {
  if (!(fieldParsersKey in parser)) return;
  const rawPairs = (parser as {
    [fieldParsersKey]: ReadonlyArray<
      readonly [string | symbol, Parser<Mode, unknown, unknown>]
    >;
  })[fieldParsersKey];
  const duplicateFieldNames = collectDuplicateFieldNames(rawPairs);
  const pairs = filterDuplicateFieldParsers(
    rawPairs,
  );
  const stateRecord = state != null && typeof state === "object"
    ? state as Record<PropertyKey, unknown>
    : {};
  const nodes = buildSuggestRuntimeNodesFromPairs(
    pairs,
    stateRecord,
    parentPath,
  );
  await collectExplicitSourceValuesAsync(nodes, runtime);
  await fillMissingSourceDefaultsAsync(nodes, runtime);
  collectSourcesFromState(
    state,
    runtime,
    new WeakSet<object>(),
    duplicateFieldNames,
  );
  await completeDependencySourceDefaultsAsync(
    {
      buffer: [],
      optionsTerminated: false,
      state: stateRecord,
      usage: parser.usage,
      dependencyRegistry: runtime.registry,
      exec: {
        usage: parser.usage,
        phase: "suggest",
        path: parentPath,
        dependencyRuntime: runtime,
        dependencyRegistry: runtime.registry,
      },
    },
    pairs,
    runtime.registry,
    {
      usage: parser.usage,
      phase: "suggest",
      path: parentPath,
      dependencyRuntime: runtime,
      dependencyRegistry: runtime.registry,
    },
  );
  for (const [field, childParser] of pairs) {
    await seedSuggestRuntimeFromFieldParsersAsync(
      childParser,
      getAnnotatedFieldState(stateRecord, field, childParser),
      runtime,
      [...parentPath, field],
    );
  }
}

/**
 * This helper replays child parsers in priority order (mirroring
 * `concat.parse()`) to accumulate dependency source values for suggestions.
 * @internal
 */
function preParseSuggestContext(
  context: ParserContext<readonly unknown[]>,
  parsers: readonly Parser<"sync", readonly unknown[], unknown>[],
): ParserContext<readonly unknown[]> {
  if (
    context.buffer.length < 1 || !Array.isArray(context.state)
  ) {
    return context;
  }
  // All parsers are sync, so the loop never returns a Promise.
  return preParseSuggestLoop(
    context,
    annotateFreshArray(context.state, context.state.slice()) as unknown[],
    parsers,
  ) as ParserContext<readonly unknown[]>;
}

/**
 * Async variant of {@link preParseSuggestContext} that awaits async child
 * parsers so that dependency sources from async sub-parsers are resolved.
 * @internal
 */
async function preParseSuggestContextAsync(
  context: ParserContext<readonly unknown[]>,
  parsers: readonly Parser<Mode, readonly unknown[], unknown>[],
): Promise<ParserContext<readonly unknown[]>> {
  if (
    context.buffer.length < 1 || !Array.isArray(context.state)
  ) {
    return context;
  }
  return await preParseSuggestLoop(
    context,
    annotateFreshArray(context.state, context.state.slice()) as unknown[],
    parsers,
  );
}

/**
 * Shared loop for sync and async concat suggest pre-parse.  When a child
 * parser returns a Promise its result is awaited; sync results are used
 * directly.  Parsers are tried in priority order, matching `concat.parse()`.
 * @internal
 */
function preParseSuggestLoop(
  context: ParserContext<readonly unknown[]>,
  stateArray: unknown[],
  parsers: readonly Parser<Mode, readonly unknown[], unknown>[],
  matchedParsers: Set<number> = new Set<number>(),
):
  | ParserContext<readonly unknown[]>
  | Promise<ParserContext<readonly unknown[]>> {
  const indexedParsers = parsers
    .map((parser, index) => [parser, index] as [typeof parser, number]);

  let currentContext = context;
  let changed = true;
  while (changed && currentContext.buffer.length > 0) {
    changed = false;
    const remaining = indexedParsers
      .filter(([_, index]) => !matchedParsers.has(index))
      .sort(([a], [b]) => b.priority - a.priority);

    const tried = tryParseSuggestList(
      currentContext,
      stateArray,
      parsers,
      matchedParsers,
      remaining,
    );
    if (tried === null) continue;
    // If a Promise was returned, the async chain continues from there.
    if (
      typeof tried === "object" && "then" in tried &&
      typeof tried.then === "function"
    ) {
      return tried as Promise<ParserContext<readonly unknown[]>>;
    }
    // A sync parser consumed input — restart the outer loop.
    currentContext = tried as ParserContext<readonly unknown[]>;
    changed = true;
  }

  return { ...currentContext, state: stateArray };
}

/**
 * Tries each parser in `remaining` once.  Returns the updated context if a
 * parser consumed input (sync), a Promise that resolves to a context if an
 * async parser was encountered, or `null` if no parser consumed.
 * @internal
 */
function tryParseSuggestList(
  context: ParserContext<readonly unknown[]>,
  stateArray: unknown[],
  parsers: readonly Parser<Mode, readonly unknown[], unknown>[],
  matchedParsers: Set<number>,
  remaining: [Parser<Mode, readonly unknown[], unknown>, number][],
):
  | ParserContext<readonly unknown[]>
  | Promise<ParserContext<readonly unknown[]>>
  | null {
  for (let ri = 0; ri < remaining.length; ri++) {
    const [parser, index] = remaining[ri];
    const parserState = index < stateArray.length
      ? stateArray[index]
      : parser.initialState;
    const resultOrPromise = parser.parse(
      withChildContext(context, index, parserState, parser),
    );

    // If the result is a thenable, chain the rest asynchronously.
    if (
      resultOrPromise != null && typeof resultOrPromise === "object" &&
      "then" in resultOrPromise && typeof resultOrPromise.then === "function"
    ) {
      const tail = remaining.slice(ri + 1);
      return (resultOrPromise as Promise<ParserResult<readonly unknown[]>>)
        .then((result) => {
          if (result.success && result.consumed.length > 0) {
            stateArray[index] = getAnnotatedChildState(
              context.state,
              result.next.state,
              parser,
            );
            matchedParsers.add(index);
            const mergedExec = mergeChildExec(context.exec, result.next.exec);
            return preParseSuggestLoop(
              {
                ...context,
                buffer: result.next.buffer,
                optionsTerminated: result.next.optionsTerminated,
                state: stateArray,
                ...(mergedExec != null
                  ? {
                    exec: mergedExec,
                    dependencyRegistry: mergedExec.dependencyRegistry,
                  }
                  : {}),
              },
              stateArray,
              parsers,
              matchedParsers,
            );
          }
          // This async parser didn't consume — try the remaining parsers.
          // If one of them consumes, restart the full outer loop.
          const next = tryParseSuggestList(
            context,
            stateArray,
            parsers,
            matchedParsers,
            tail,
          );
          if (next === null) return { ...context, state: stateArray };
          // A tail parser consumed — restart the loop on the updated
          // context, but only if the buffer actually shrank; otherwise
          // we'd re-enter with the same state and recurse infinitely.
          if (
            typeof next === "object" && "then" in next &&
            typeof next.then === "function"
          ) {
            return (next as Promise<ParserContext<readonly unknown[]>>)
              .then((ctx) =>
                ctx.buffer.length < context.buffer.length
                  ? preParseSuggestLoop(
                    ctx,
                    stateArray,
                    parsers,
                    matchedParsers,
                  )
                  : ctx
              );
          }
          const nextCtx = next as ParserContext<readonly unknown[]>;
          if (nextCtx.buffer.length < context.buffer.length) {
            return preParseSuggestLoop(
              nextCtx,
              stateArray,
              parsers,
              matchedParsers,
            );
          }
          return nextCtx;
        });
    }

    const result = resultOrPromise as ParserResult<readonly unknown[]>;
    if (result.success && result.consumed.length > 0) {
      stateArray[index] = getAnnotatedChildState(
        context.state,
        result.next.state,
        parser,
      );
      matchedParsers.add(index);
      const mergedExec = mergeChildExec(context.exec, result.next.exec);
      return {
        ...context,
        buffer: result.next.buffer,
        optionsTerminated: result.next.optionsTerminated,
        state: stateArray,
        ...(mergedExec != null
          ? {
            exec: mergedExec,
            dependencyRegistry: mergedExec.dependencyRegistry,
          }
          : {}),
      };
    }
  }

  return null;
}

/**
 * Concatenates tuple parsers into one parser with a flattened tuple value.
 *
 * Unlike {@link merge}, which combines object fields, this combines tuple
 * entries in order into one flattened tuple value.
 *
 * @example
 * ```typescript
 * import { parse } from "@optique/core/parser";
 * import { option } from "@optique/core/primitives";
 * import { integer, string } from "@optique/core/valueparser";
 *
 * const basicTuple = tuple([
 *   option("-v", "--verbose"),
 *   option("-p", "--port", integer()),
 * ]);
 *
 * const serverTuple = tuple([
 *   option("-h", "--host", string()),
 *   option("-d", "--debug"),
 * ]);
 *
 * const combined = concat(basicTuple, serverTuple);
 * // Inferred type: Parser<..., [boolean, number, string, boolean], ...>
 *
 * const result = parse(
 *   combined,
 *   ["-v", "-p", "8080", "-h", "localhost", "-d"],
 * );
 * // result.value: [true, 8080, "localhost", true]
 * ```
 *
 * @param parsers Tuple parsers to concatenate.
 * @returns A parser with flattened tuple values from all parsers.
 * Type inference is precise for tuple calls up to 15 parser arguments.
 * @throws {TypeError} If no parser arguments are provided.
 * @since 0.2.0
 */
export function concat<const TParsers extends ConcatParsers>(
  ...parsers: TParsers & ConcatArityGuard<TParsers>
): Parser<
  CombineModes<{ readonly [K in keyof TParsers]: ExtractMode<TParsers[K]> }>,
  ConcatValues<TParsers>,
  ConcatStates<TParsers>
>;

export function concat(
  ...parsers: Parser<Mode, readonly unknown[], unknown>[]
): Parser<Mode, readonly unknown[], readonly unknown[]> {
  if (parsers.length < 1) {
    throw new TypeError("concat() requires at least one parser argument.");
  }
  assertParsers(parsers, "concat()");

  // Compute combined mode: if any parser is async, the result is async
  const combinedMode: Mode = parsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  // Cast to sync parsers for sync operations
  const syncParsers = parsers as Parser<"sync", readonly unknown[], unknown>[];

  const initialState = parsers.map((parser) => parser.initialState);

  type ConcatContext = ParserContext<readonly unknown[]>;
  type ConcatResult = ParserResult<readonly unknown[]>;

  // Sync parse implementation
  const parseSync = (context: ConcatContext): ConcatResult => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Use the exact same logic as tuple() to avoid infinite loops
    while (matchedParsers.size < syncParsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = syncParsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const result = parser.parse(
          withChildContext(currentContext, index, stateArray[index], parser),
        );

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = annotateFreshArray(
            currentContext.state,
            stateArray.map((s, idx) =>
              idx === index
                ? getAnnotatedChildState(
                  currentContext.state,
                  result.next.state,
                  parser,
                )
                : s
            ),
          );
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as readonly unknown[],
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const result = parser.parse(
            withChildContext(currentContext, index, stateArray[index], parser),
          );

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = annotateFreshArray(
              currentContext.state,
              stateArray.map((s, idx) =>
                idx === index
                  ? getAnnotatedChildState(
                    currentContext.state,
                    result.next.state,
                    parser,
                  )
                  : s
              ),
            );
            const mergedExec = mergeChildExec(
              currentContext.exec,
              result.next.exec,
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as readonly unknown[],
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  // Async parse implementation
  const parseAsync = async (context: ConcatContext): Promise<ConcatResult> => {
    let currentContext = context;
    const allConsumed: string[] = [];
    const matchedParsers = new Set<number>();

    // Use the exact same logic as tuple() to avoid infinite loops
    while (matchedParsers.size < parsers.length) {
      let foundMatch = false;
      let error: { consumed: number; error: Message } = {
        consumed: 0,
        error: message`No remaining parsers could match the input.`,
      };

      // Get current state array from context (may have been updated in previous iterations)
      const stateArray = currentContext.state as unknown[];

      // Create priority-ordered list of remaining parsers
      const remainingParsers = parsers
        .map((parser, index) => [parser, index] as [typeof parser, number])
        .filter(([_, index]) => !matchedParsers.has(index))
        .sort(([parserA], [parserB]) => parserB.priority - parserA.priority);

      for (const [parser, index] of remainingParsers) {
        const result = await parser.parse(
          withChildContext(currentContext, index, stateArray[index], parser),
        );

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = annotateFreshArray(
            currentContext.state,
            stateArray.map((s, idx) =>
              idx === index
                ? getAnnotatedChildState(
                  currentContext.state,
                  result.next.state,
                  parser,
                )
                : s
            ),
          );
          const mergedExec = mergeChildExec(
            currentContext.exec,
            result.next.exec,
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as readonly unknown[],
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          };

          allConsumed.push(...result.consumed);
          matchedParsers.add(index);
          foundMatch = true;
          break; // Take the first (highest priority) match that consumes input
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
        }
      }

      // If no consuming parser matched, try non-consuming ones (like optional)
      // or mark failing optional parsers as matched
      if (!foundMatch) {
        for (const [parser, index] of remainingParsers) {
          const result = await parser.parse(
            withChildContext(currentContext, index, stateArray[index], parser),
          );

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = annotateFreshArray(
              currentContext.state,
              stateArray.map((s, idx) =>
                idx === index
                  ? getAnnotatedChildState(
                    currentContext.state,
                    result.next.state,
                    parser,
                  )
                  : s
              ),
            );
            const mergedExec = mergeChildExec(
              currentContext.exec,
              result.next.exec,
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as readonly unknown[],
              ...(mergedExec != null
                ? {
                  exec: mergedExec,
                  dependencyRegistry: mergedExec.dependencyRegistry,
                }
                : {}),
            };

            matchedParsers.add(index);
            foundMatch = true;
            break;
          } else if (!result.success && result.consumed < 1) {
            // Parser failed without consuming input - this could be
            // an optional parser that doesn't match.
            // Check if we can safely skip it.
            // For now, mark it as matched to continue processing
            matchedParsers.add(index);
            foundMatch = true;
            break;
          }
        }
      }

      if (!foundMatch) {
        return { ...error, success: false };
      }
    }

    return {
      success: true,
      next: currentContext,
      consumed: allConsumed,
    };
  };

  type CompleteResult = ValueParserResult<readonly unknown[]>;

  // Sync complete implementation
  const completeSync = (
    state: readonly unknown[],
    exec?: ExecutionContext,
  ): CompleteResult => {
    const stateArray = state as unknown[];

    // Phase 1: Build dependency runtime and pre-complete dependency
    // source parsers before resolving deferred states.
    const runtime = exec?.dependencyRuntime ??
      createDependencyRuntimeContext(exec?.dependencyRegistry);
    const childExec: ExecutionContext = {
      ...exec,
      dependencyRuntime: runtime,
    } as ExecutionContext;
    const concatPairs = buildIndexedParserPairs(syncParsers);
    const concatState = createAnnotatedArrayStateRecord(stateArray);
    const preCompleted = preCompleteAndRegisterDependencies(
      concatState,
      concatPairs,
      runtime.registry,
      childExec,
    );
    collectExplicitSourceValues(
      filterPreCompletedRuntimeNodes(
        buildRuntimeNodesFromArray(syncParsers, stateArray, exec?.path),
        new Set(preCompleted.keys()),
      ),
      runtime,
    );
    const phase3Exec: ExecutionContext = {
      ...childExec,
      preCompletedByParser: undefined,
    } as ExecutionContext;

    // Phase 2: Resolve deferred parse states across all tuples using runtime.
    const resolvedArray = resolveStateWithRuntime(
      stateArray,
      runtime,
    ) as unknown[];

    // Phase 3: Complete each parser with resolved state
    const results: unknown[] = [];
    const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
    let hasDeferred = false;
    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const preCompletedResult = preCompleted.get(String(i));
      const result = preCompletedResult !== undefined
        ? unwrapCompleteResult(preCompletedResult)
        : unwrapCompleteResult(
          parser.complete(
            prepareStateForCompletion(resolvedArray[i], parser),
            withChildExecPath(phase3Exec, i),
          ),
        );
      if (!result.success) return result;

      // Flatten the tuple results, remapping deferred keys to the
      // flattened output indices so prepareParsedForContexts() can
      // strip them correctly.
      const baseIndex = results.length;
      if (Array.isArray(result.value)) {
        results.push(...result.value);
        if (result.deferred && result.deferredKeys) {
          for (const [key, value] of result.deferredKeys) {
            const numKey = typeof key === "string" ? Number(key) : key;
            if (typeof numKey === "number" && Number.isInteger(numKey)) {
              deferredKeys.set(baseIndex + numKey, value);
            } else {
              deferredKeys.set(key, value);
            }
          }
        } else if (result.deferred) {
          // Opaque deferred array child (e.g., after map()). Don't
          // mark all indices — that would blank out non-deferred
          // elements. Let them pass through with placeholder values.
          hasDeferred = true;
        }
      } else {
        results.push(result.value);
        if (result.deferred) {
          if (result.deferredKeys) {
            deferredKeys.set(baseIndex, result.deferredKeys);
          } else if (
            result.value == null || typeof result.value !== "object"
          ) {
            // Scalar deferred child — record its index.
            deferredKeys.set(baseIndex, null);
          } else {
            hasDeferred = true;
          }
        }
      }
    }
    const isDeferred = deferredKeys.size > 0 || hasDeferred;
    return {
      success: true,
      value: results,
      ...(isDeferred
        ? {
          deferred: true as const,
          ...(deferredKeys.size > 0
            ? { deferredKeys: deferredKeys as DeferredMap }
            : {}),
        }
        : {}),
    };
  };

  // Async complete implementation
  const completeAsync = async (
    state: readonly unknown[],
    exec?: ExecutionContext,
  ): Promise<CompleteResult> => {
    const stateArray = state as unknown[];

    // Phase 1: Build dependency runtime and pre-complete dependency
    // source parsers before resolving deferred states.
    const runtime = exec?.dependencyRuntime ??
      createDependencyRuntimeContext(exec?.dependencyRegistry);
    const childExec: ExecutionContext = {
      ...exec,
      dependencyRuntime: runtime,
    } as ExecutionContext;
    const concatPairs = buildIndexedParserPairs(parsers);
    const concatState = createAnnotatedArrayStateRecord(stateArray);
    const preCompleted = await preCompleteAndRegisterDependenciesAsync(
      concatState,
      concatPairs,
      runtime.registry,
      childExec,
    );
    await collectExplicitSourceValuesAsync(
      filterPreCompletedRuntimeNodes(
        buildRuntimeNodesFromArray(parsers, stateArray, exec?.path),
        new Set(preCompleted.keys()),
      ),
      runtime,
    );
    const phase3Exec: ExecutionContext = {
      ...childExec,
      preCompletedByParser: undefined,
    } as ExecutionContext;

    // Phase 2: Resolve deferred parse states across all tuples using runtime.
    const resolvedArray = await resolveStateWithRuntimeAsync(
      stateArray,
      runtime,
    ) as unknown[];

    // Phase 3: Complete each parser with resolved state
    const results: unknown[] = [];
    const deferredKeys = new Map<PropertyKey, DeferredMap | null>();
    let hasDeferred = false;
    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const preCompletedResult = preCompleted.get(String(i));
      const result = preCompletedResult !== undefined
        ? unwrapCompleteResult(preCompletedResult)
        : unwrapCompleteResult(
          await parser.complete(
            prepareStateForCompletion(resolvedArray[i], parser),
            withChildExecPath(phase3Exec, i),
          ),
        );
      if (!result.success) return result;

      // Flatten the tuple results, remapping deferred keys to the
      // flattened output indices.
      const baseIndex = results.length;
      if (Array.isArray(result.value)) {
        results.push(...result.value);
        if (result.deferred && result.deferredKeys) {
          for (const [key, value] of result.deferredKeys) {
            const numKey = typeof key === "string" ? Number(key) : key;
            if (typeof numKey === "number" && Number.isInteger(numKey)) {
              deferredKeys.set(baseIndex + numKey, value);
            } else {
              deferredKeys.set(key, value);
            }
          }
        } else if (result.deferred) {
          hasDeferred = true;
        }
      } else {
        results.push(result.value);
        if (result.deferred) {
          if (result.deferredKeys) {
            deferredKeys.set(baseIndex, result.deferredKeys);
          } else if (
            result.value == null || typeof result.value !== "object"
          ) {
            // Scalar deferred child — record its index.
            deferredKeys.set(baseIndex, null);
          } else {
            hasDeferred = true;
          }
        }
      }
    }
    const isDeferred = deferredKeys.size > 0 || hasDeferred;
    return {
      success: true,
      value: results,
      ...(isDeferred
        ? {
          deferred: true as const,
          ...(deferredKeys.size > 0
            ? { deferredKeys: deferredKeys as DeferredMap }
            : {}),
        }
        : {}),
    };
  };

  const concatParser = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: parsers.length > 0
      ? Math.max(...parsers.map((p) => p.priority))
      : 0,
    usage: parsers.flatMap((p) => p.usage),
    leadingNames: sharedBufferLeadingNames(parsers),
    acceptingAnyToken: parsers.some((p) => p.acceptingAnyToken),
    initialState,
    parse(context) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },
    complete(state, exec?) {
      if (isAsync) {
        return completeAsync(state, exec);
      }
      return completeSync(state, exec);
    },
    suggest(context, prefix) {
      if (isAsync) {
        return (async function* () {
          // Pre-parse the buffer (awaiting async children) to build up
          // state across sub-parsers for dependency resolution.
          const preParsedContext = await preParseSuggestContextAsync(
            context,
            parsers,
          );
          const { context: contextWithRegistry, stateArray } =
            await buildSuggestRegistryAsync(preParsedContext, parsers);

          const suggestions: Suggestion[] = [];

          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserState = stateArray && Array.isArray(stateArray)
              ? stateArray[i]
              : parser.initialState;

            const parserSuggestions = parser.suggest(
              withChildContext(contextWithRegistry, i, parserState, parser),
              prefix,
            );

            if (parser.$mode === "async") {
              for await (
                const s of parserSuggestions as AsyncIterable<Suggestion>
              ) {
                suggestions.push(s);
              }
            } else {
              suggestions.push(...(parserSuggestions as Iterable<Suggestion>));
            }
          }

          yield* deduplicateSuggestions(suggestions);
        })();
      }

      // Sync branch: pre-parse sync children only.
      const preParsedContext = preParseSuggestContext(
        context,
        syncParsers,
      );
      const { context: contextWithRegistry, stateArray } = buildSuggestRegistry(
        preParsedContext,
        syncParsers,
      );

      return (function* () {
        const suggestions: Suggestion[] = [];

        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = stateArray && Array.isArray(stateArray)
            ? stateArray[i]
            : parser.initialState;

          const parserSuggestions = parser.suggest(
            withChildContext(contextWithRegistry, i, parserState, parser),
            prefix,
          );

          suggestions.push(...parserSuggestions);
        }

        yield* deduplicateSuggestions(suggestions);
      })();
    },
    getDocFragments(state: DocState<readonly unknown[]>, _defaultValue?) {
      const fragments = syncParsers.flatMap((p, index) => {
        const indexState: DocState<unknown> = state.kind === "unavailable"
          ? { kind: "unavailable" }
          : { kind: "available", state: state.state[index] };
        return p.getDocFragments(indexState, undefined).fragments;
      });
      const entries: DocEntry[] = fragments.filter((f) => f.type === "entry");
      const sections: DocSection[] = [];
      for (const fragment of fragments) {
        if (fragment.type !== "section") continue;
        if (fragment.title == null) {
          entries.push(...fragment.entries);
        } else {
          sections.push(fragment);
        }
      }
      const result: DocFragment[] = [
        ...sections.map<DocFragment>((s) => ({ ...s, type: "section" })),
      ];
      if (entries.length > 0) {
        result.push({ type: "section", entries });
      }
      return { fragments: result };
    },
  } as Parser<Mode, readonly unknown[], readonly unknown[]>;
  defineInheritedAnnotationParser(concatParser);
  return concatParser;
}

/**
 * Wraps a parser with a group label for documentation purposes.
 *
 * The `group()` function is a documentation-only wrapper that applies a label
 * to any parser for help text organization. This allows you to use clean code
 * structure with combinators like {@link merge} while maintaining well-organized
 * help text through group labeling.
 *
 * The wrapped parser has identical parsing behavior but generates documentation
 * fragments wrapped in a labeled section. This is particularly useful when
 * combining parsers using {@link merge}—you can wrap the merged result with
 * `group()` to add a section header in help output.
 *
 * @example
 * ```typescript
 * const apiOptions = merge(
 *   object({ endpoint: option("--endpoint", string()) }),
 *   object({ timeout: option("--timeout", integer()) })
 * );
 *
 * const groupedApiOptions = group("API Options", apiOptions);
 * // Now produces a labeled "API Options" section in help text
 * ```
 *
 * @example
 * ```typescript
 * // Can be used with any parser, not just merge()
 * const verboseGroup = group("Verbosity", object({
 *   verbose: option("-v", "--verbose"),
 *   quiet: option("-q", "--quiet")
 * }));
 * ```
 *
 * @template TValue The value type of the wrapped parser.
 * @template TState The state type of the wrapped parser.
 * @param label A descriptive label for this parser group, used for
 *              documentation and help text organization.
 * @param parser The parser to wrap with a group label.
 * @param options Optional visibility controls for the wrapped parser terms.
 * @returns A new parser that behaves identically to the input parser
 *          but generates documentation within a labeled section.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 * @since 0.4.0
 */
/**
 * Options for the {@link group} parser wrapper.
 * @since 1.0.0
 */
export interface GroupOptions {
  /**
   * Controls visibility of all terms emitted by this group.
   */
  readonly hidden?: HiddenVisibility;
}

export function group<M extends Mode, TValue, TState>(
  label: string,
  parser: Parser<M, TValue, TState>,
  options: GroupOptions = {},
): Parser<M, TValue, TState> {
  validateLabel(label);
  const groupParser: Parser<M, TValue, TState> = {
    $mode: parser.$mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: applyHiddenToUsage(parser.usage, options.hidden),
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: parser.initialState,
    // Forward field parser pairs from inner parser so that merge()
    // can pre-complete dependency source fields from grouped children.
    // See: https://github.com/dahlia/optique/issues/681
    ...(fieldParsersKey in parser
      ? {
        [fieldParsersKey]: (
          parser as { [fieldParsersKey]: unknown }
        )[fieldParsersKey],
      }
      : {}),
    // Forward completion deferral hook from inner parser so that
    // prompt(group("label", bindConfig(...))) defers correctly.
    ...(typeof parser.shouldDeferCompletion === "function"
      ? {
        shouldDeferCompletion: parser.shouldDeferCompletion.bind(parser),
      }
      : {}),
    getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
      return parser.getSuggestRuntimeNodes?.(state, path) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path, parser, state }]
          : []);
    },
    parse: (context) => parser.parse(context),
    complete: (state, exec?) => parser.complete(state, exec),
    suggest: (context, prefix) => {
      if (options.hidden === true) {
        return dispatchIterableByMode(
          parser.$mode,
          function* () {},
          async function* () {},
        );
      }
      return parser.suggest(context, prefix);
    },
    getDocFragments: (state, defaultValue) => {
      const { brief, description, footer, fragments } = parser.getDocFragments(
        state,
        defaultValue,
      );
      const hiddenAwareFragments = applyHiddenToDocFragments(
        fragments,
        options.hidden,
      );

      // Collect all entries and titled sections
      const allEntries: DocEntry[] = [];
      const titledSections: DocSection[] = [];

      for (const fragment of hiddenAwareFragments) {
        if (fragment.type === "entry") {
          allEntries.push(fragment);
        } else if (fragment.type === "section") {
          if (fragment.title) {
            // Preserve sections with titles (nested groups)
            titledSections.push(fragment);
          } else {
            // Merge entries from sections without titles into our labeled section
            allEntries.push(...fragment.entries);
          }
        }
      }

      // Only apply the group label when the entries still represent what
      // the group was originally labeling.  When group() wraps command
      // parsers (via or()), the initial state produces command entries.
      // Once a command is selected, the inner parser's flags/options are
      // returned instead — the group label should not apply to those.
      //
      // Additionally, if the selected command itself exposes further nested
      // subcommands (e.g. `alias` containing `delete`, `set`, …), those
      // inner commands are *not* the group's own commands, so the label
      // must not be applied to them either.  We detect this by collecting
      // the command names from the initial state and checking whether the
      // currently visible command entries overlap with that set.  If none
      // of the current commands belong to the original set, the group label
      // is suppressed.
      // See: https://github.com/dahlia/optique/issues/114
      // See: https://github.com/dahlia/optique/issues/116
      const initialFragments = parser.getDocFragments(
        { kind: "available", state: parser.initialState },
        undefined,
      );
      const initialCommandNames = new Set<string>();
      for (const f of initialFragments.fragments) {
        if (f.type === "entry" && f.term.type === "command") {
          initialCommandNames.add(f.term.name);
        } else if (f.type === "section") {
          for (const e of f.entries) {
            if (e.term.type === "command") {
              initialCommandNames.add(e.term.name);
            }
          }
        }
      }
      const initialHasCommands = initialCommandNames.size > 0;
      // True only when the visible commands are the group's own top-level
      // commands (same set as the initial state), not inner subcommands
      // that surfaced after a command was selected.
      const currentCommandsAreGroupOwn = allEntries.some(
        (e) =>
          e.term.type === "command" && initialCommandNames.has(e.term.name),
      );
      const applyLabel = !initialHasCommands || currentCommandsAreGroupOwn;
      const labeledSection: DocSection = applyLabel
        ? { title: label, entries: allEntries }
        : { entries: allEntries };

      return {
        brief,
        description,
        footer,
        fragments: [
          ...titledSections.map<DocFragment>((s) => ({
            ...s,
            type: "section",
          })),
          { type: "section", ...labeledSection },
        ],
      };
    },
  };
  Object.defineProperty(groupParser, extractPhase2SeedKey, {
    value(state: TState, exec?: ExecutionContext) {
      return extractPhase2Seed(parser, state, exec);
    },
    configurable: true,
    enumerable: false,
  });
  // Lazily forward placeholder from inner parser to avoid eagerly
  // evaluating derived value parser factories at construction time.
  if ("placeholder" in parser) {
    Object.defineProperty(groupParser, "placeholder", {
      get() {
        return parser.placeholder;
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value normalization as non-enumerable.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(groupParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  // Forward fallback validation as non-enumerable (see issue #414).
  // group() is a thin wrapper around its inner parser, so validateValue
  // delegates transparently.
  if (typeof parser.validateValue === "function") {
    Object.defineProperty(groupParser, "validateValue", {
      value: parser.validateValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  return groupParser;
}

/**
 * Tagged union type representing which branch is selected.
 * Uses tagged union to avoid collision with discriminator values.
 * @internal
 */
type SelectedBranch<TDiscriminator extends string> =
  | { readonly kind: "branch"; readonly key: TDiscriminator }
  | { readonly kind: "default" };

/**
 * State type for the conditional parser.
 * @internal
 */
interface ConditionalState<TDiscriminator extends string> {
  readonly discriminatorState: unknown;
  readonly discriminatorValue: TDiscriminator | undefined;
  readonly selectedBranch: SelectedBranch<TDiscriminator> | undefined;
  readonly branchState: unknown;
  readonly speculative?: true;
}

/**
 * Options for customizing error messages in the {@link conditional} combinator.
 * @since 0.8.0
 */
export interface ConditionalErrorOptions {
  /**
   * Custom error message when branch parser fails.
   * Receives the discriminator value for context.
   */
  readonly branchError?: (
    discriminatorValue: string | undefined,
    error: Message,
  ) => Message;

  /**
   * Custom error message for no matching input.
   */
  readonly noMatch?: Message | ((context: NoMatchContext) => Message);

  /**
   * Custom error message when speculative branch parsing committed
   * to one branch but the resolved discriminator value names a
   * different branch.  This is the contradictory-input case: tokens
   * specific to one branch were consumed during the parse phase,
   * but the discriminator (e.g., from `prompt()` or a deferred
   * config source) ultimately resolved to a different key.
   *
   * Receives both the discriminator value the parser actually
   * resolved to (`discriminatorValue`) and the speculative key the
   * branch tokens were committed to (`speculativeKey`).
   * @since 1.0.1
   */
  readonly branchMismatch?: (
    discriminatorValue: string,
    speculativeKey: string,
  ) => Message;
}

/**
 * Options for customizing the {@link conditional} combinator behavior.
 * @since 0.8.0
 */
export interface ConditionalOptions {
  /**
   * Custom error messages.
   */
  readonly errors?: ConditionalErrorOptions;
}

/**
 * Helper type to infer result type without default branch.
 * @internal
 */
type ConditionalResultWithoutDefault<
  TDiscriminator extends string,
  TBranches extends Record<string, Parser<Mode, unknown, unknown>>,
> = {
  [K in keyof TBranches & string]: readonly [K, InferValue<TBranches[K]>];
}[keyof TBranches & string];

/**
 * Helper type to infer result type with default branch.
 * @internal
 */
type ConditionalResultWithDefault<
  TDiscriminator extends string,
  TBranches extends Record<string, Parser<Mode, unknown, unknown>>,
  TDefault extends Parser<Mode, unknown, unknown>,
> =
  | ConditionalResultWithoutDefault<TDiscriminator, TBranches>
  | readonly [undefined, InferValue<TDefault>];

/**
 * Creates a conditional parser without a default branch.
 * The discriminator option is required; parsing fails if not provided.
 *
 * @template TDiscriminator The string literal union type of discriminator values.
 * @template TBranches Record mapping discriminator values to branch parsers.
 * @param discriminator Parser for the discriminator option (typically using choice()).
 * @param branches Object mapping each discriminator value to its branch parser.
 * @returns A parser that produces a tuple `[discriminatorValue, branchResult]`.
 * @since 0.8.0
 */
export function conditional<
  TDiscriminator extends string,
  TBranches extends { [K in TDiscriminator]: Parser<Mode, unknown, unknown> },
  TD extends Parser<Mode, TDiscriminator, unknown>,
>(
  discriminator: TD,
  branches: TBranches,
): Parser<
  CombineModes<
    readonly [
      ExtractMode<TD>,
      ...{
        [K in keyof TBranches]: ExtractMode<TBranches[K]>;
      }[keyof TBranches][],
    ]
  >,
  ConditionalResultWithoutDefault<TDiscriminator, TBranches>,
  ConditionalState<TDiscriminator>
>;

/**
 * Creates a conditional parser with a default branch.
 * The default branch is used when the discriminator option is not provided.
 *
 * @template TDiscriminator The string literal union type of discriminator values.
 * @template TBranches Record mapping discriminator values to branch parsers.
 * @template TDefault The default branch parser type.
 * @param discriminator Parser for the discriminator option (typically using choice()).
 * @param branches Object mapping each discriminator value to its branch parser.
 * @param defaultBranch Parser to use when discriminator is not provided.
 * @param options Optional configuration for error messages.
 * @returns A parser that produces a tuple `[discriminatorValue | undefined, branchResult]`.
 * @since 0.8.0
 */
export function conditional<
  TDiscriminator extends string,
  TBranches extends { [K in TDiscriminator]: Parser<Mode, unknown, unknown> },
  TDefault extends Parser<Mode, unknown, unknown>,
  TD extends Parser<Mode, TDiscriminator, unknown>,
>(
  discriminator: TD,
  branches: TBranches,
  defaultBranch: TDefault,
  options?: ConditionalOptions,
): Parser<
  CombineModes<
    readonly [
      ExtractMode<TD>,
      ExtractMode<TDefault>,
      ...{
        [K in keyof TBranches]: ExtractMode<TBranches[K]>;
      }[keyof TBranches][],
    ]
  >,
  ConditionalResultWithDefault<TDiscriminator, TBranches, TDefault>,
  ConditionalState<TDiscriminator>
>;

/**
 * Creates a conditional parser that selects different branch parsers based on
 * a discriminator option value. This enables discriminated union patterns where
 * certain options are only required or available when a specific discriminator
 * value is selected.
 *
 * The result type is a tuple: `[discriminatorValue, branchResult]`
 *
 * @example
 * ```typescript
 * // Basic conditional parsing
 * const parser = conditional(
 *   option("--reporter", choice(["console", "junit"])),
 *   {
 *     console: object({}),
 *     junit: object({ outputFile: option("--output-file", string()) }),
 *   },
 *   object({}) // default when --reporter is not provided
 * );
 *
 * const result = parse(parser, ["--reporter", "junit", "--output-file", "out.xml"]);
 * // result.value = ["junit", { outputFile: "out.xml" }]
 *
 * // Without --reporter, uses default branch:
 * const defaultResult = parse(parser, []);
 * // defaultResult.value = [undefined, {}]
 * ```
 *
 * ### Speculative branch parsing
 *
 * When the discriminator is an async parser that succeeds without consuming
 * input (e.g., `prompt(option(...))` with no CLI input), branch selection
 * is normally deferred to the complete phase.  To allow branch-specific
 * tokens to be consumed, `conditional()` speculatively tries all named
 * branches during parse.  If exactly one branch can consume tokens, it is
 * tentatively selected and verified against the resolved discriminator
 * during the complete phase.
 *
 * If the discriminator resolves to a different branch than the one that
 * consumed tokens (contradictory input), the parse fails.  When multiple
 * branches can consume the same tokens (ambiguous), speculation is skipped
 * entirely to keep branch selection order-independent.
 *
 * #### Known limitations
 *
 * - When a default branch accepts the same tokens as a named branch,
 *   speculation prefers the named branch.  If the discriminator later
 *   resolves to a value not in the named branches, the parse fails
 *   instead of falling back to the default branch.  To avoid this,
 *   ensure named branch options are distinct from the default branch.
 * - Within `longestMatch()`, a longer speculative match can beat a
 *   shorter definitive one.  If the speculative match fails during
 *   completion, the tokens consumed by it are not recoverable.
 *
 * @since 0.8.0
 */
export function conditional(
  discriminator: Parser<Mode, string, unknown>,
  branches: Record<string, Parser<Mode, unknown, unknown>>,
  defaultBranch?: Parser<Mode, unknown, unknown>,
  options?: ConditionalOptions,
): Parser<
  Mode,
  readonly [string | undefined, unknown],
  ConditionalState<string>
> {
  const branchParsers = Object.entries(branches);
  const allBranchParsers = defaultBranch
    ? [...branchParsers.map(([_, p]) => p), defaultBranch]
    : branchParsers.map(([_, p]) => p);

  // Compute combined mode
  const combinedMode: Mode = discriminator.$mode === "async" ||
      allBranchParsers.some((p) => p.$mode === "async")
    ? "async"
    : "sync";

  const isAsync = combinedMode === "async";

  const maxPriority = Math.max(
    discriminator.priority,
    ...allBranchParsers.map((p) => p.priority),
  );

  // Helper to replace metavar with literal value after the option in usage.
  // Only option terms with metavar are rewritten: the metavar is stripped
  // and a literal term is appended.  Argument terms are left unchanged
  // because map() is invisible in the usage tree, so we cannot tell
  // whether the branch key equals the raw argv token or a transformed
  // value.  See https://github.com/dahlia/optique/issues/734
  function appendLiteralToUsage(usage: Usage, literalValue: string): Usage {
    const result: UsageTerm[] = [];
    for (const term of usage) {
      if (term.type === "option" && term.metavar !== undefined) {
        // Add option without metavar, then add a literal term
        const { metavar: _, ...optionWithoutMetavar } = term;
        result.push(optionWithoutMetavar);
        result.push({
          type: "literal",
          value: literalValue,
          optionValue: true,
        });
      } else if (term.type === "optional") {
        result.push({
          ...term,
          terms: appendLiteralToUsage(term.terms, literalValue),
        });
      } else if (term.type === "multiple") {
        result.push({
          ...term,
          terms: appendLiteralToUsage(term.terms, literalValue),
        });
      } else if (term.type === "exclusive") {
        result.push({
          ...term,
          terms: term.terms.map((t) => appendLiteralToUsage(t, literalValue)),
        });
      } else {
        result.push(term);
      }
    }
    return result;
  }

  // Build usage: discriminator (with literal value) + exclusive branches
  const branchUsages: Usage[] = branchParsers.map(([key, p]) => [
    ...appendLiteralToUsage(discriminator.usage, key),
    ...p.usage,
  ]);
  if (defaultBranch) {
    branchUsages.push(defaultBranch.usage);
  }

  const usage: Usage = branchUsages.length > 1
    ? [{ type: "exclusive", terms: branchUsages }]
    : branchUsages[0] ?? [];

  const initialState: ConditionalState<string> = {
    discriminatorState: discriminator.initialState,
    discriminatorValue: undefined,
    selectedBranch: undefined,
    branchState: undefined,
  };

  // Helper to generate no-match error
  const getNoMatchError = (): Message => {
    const noMatchContext = analyzeNoMatchContext([
      discriminator,
      ...allBranchParsers,
    ]);
    return options?.errors?.noMatch
      ? typeof options.errors.noMatch === "function"
        ? options.errors.noMatch(noMatchContext)
        : options.errors.noMatch
      : generateNoMatchError(noMatchContext);
  };

  type ParseResult = ParserResult<ConditionalState<string>>;

  // Sync parse implementation
  const parseSync = (
    context: ParserContext<ConditionalState<string>>,
  ): ParseResult => {
    const state = context.state ?? initialState;
    const syncDiscriminator = discriminator as Parser<"sync", string, unknown>;
    const syncBranches = branches as Record<
      string,
      Parser<"sync", unknown, unknown>
    >;
    const syncDefaultBranch = defaultBranch as
      | Parser<"sync", unknown, unknown>
      | undefined;

    // If branch already selected, delegate to it
    if (state.selectedBranch !== undefined) {
      const branchParser = state.selectedBranch.kind === "default"
        ? syncDefaultBranch!
        : syncBranches[state.selectedBranch.key];

      const branchResult = branchParser.parse(
        withChildContext(
          context,
          "_branch",
          state.branchState,
          branchParser,
          branchParser.usage,
        ),
      );

      if (branchResult.success) {
        const mergedExec = mergeChildExec(context.exec, branchResult.next.exec);
        return {
          success: true,
          next: {
            ...branchResult.next,
            state: {
              ...state,
              branchState: getAnnotatedChildState(
                state,
                branchResult.next.state,
                branchParser,
              ),
            },
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: branchResult.consumed,
        };
      }
      return branchResult;
    }

    // Try to parse discriminator first
    const discriminatorResult = syncDiscriminator.parse({
      ...withChildContext(
        context,
        "_discriminator",
        state.discriminatorState,
        syncDiscriminator,
      ),
    });

    if (discriminatorResult.success) {
      const annotatedDiscriminatorState = getAnnotatedChildState(
        state,
        discriminatorResult.next.state,
        syncDiscriminator,
      );
      // Complete discriminator to get the value
      const completionResult = syncDiscriminator.complete(
        annotatedDiscriminatorState,
        withChildExecPath(context.exec, "_discriminator"),
      );

      if (completionResult.success) {
        const value = completionResult.value;
        const branchParser = syncBranches[value];

        if (branchParser) {
          // Try to parse more from the branch
          const discriminatorExec = mergeChildExec(
            context.exec,
            discriminatorResult.next.exec,
          );
          const branchParseResult = branchParser.parse({
            ...withChildContext(
              {
                ...context,
                ...(discriminatorExec != null
                  ? {
                    exec: discriminatorExec,
                    dependencyRegistry: discriminatorExec.dependencyRegistry,
                  }
                  : {}),
              },
              "_branch",
              branchParser.initialState,
              branchParser,
              branchParser.usage,
            ),
            buffer: discriminatorResult.next.buffer,
            optionsTerminated: discriminatorResult.next.optionsTerminated,
          });

          if (branchParseResult.success) {
            const mergedExec = mergeChildExec(
              discriminatorExec,
              branchParseResult.next.exec,
            );
            // Mark as provisional when the result is tentative:
            // either the branch itself is provisional, or the
            // discriminator consumed nothing and the branch is
            // interactive (has leadingNames or accepts any token),
            // meaning it can match tokens but didn't.
            const isProvisional = branchParseResult.provisional ||
              (discriminatorResult.consumed.length === 0 &&
                branchParseResult.consumed.length === 0 &&
                (branchParser.leadingNames.size > 0 ||
                  branchParser.acceptingAnyToken));
            return {
              success: true,
              ...(isProvisional ? { provisional: true as const } : {}),
              next: {
                ...branchParseResult.next,
                state: {
                  discriminatorState: annotatedDiscriminatorState,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: getAnnotatedChildState(
                    state,
                    branchParseResult.next.state,
                    branchParser,
                  ),
                },
                ...(mergedExec != null
                  ? {
                    exec: mergedExec,
                    dependencyRegistry: mergedExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: [
                ...discriminatorResult.consumed,
                ...branchParseResult.consumed,
              ],
            };
          }

          // Branch parse failed but discriminator succeeded.
          if (discriminatorResult.consumed.length > 0) {
            // Discriminator consumed input — commit to the branch even
            // though it hasn't consumed yet (it may on the next call).
            return {
              success: true,
              next: {
                ...discriminatorResult.next,
                state: {
                  discriminatorState: annotatedDiscriminatorState,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: getAnnotatedChildState(
                    state,
                    branchParser.initialState,
                    branchParser,
                  ),
                },
                ...(discriminatorExec != null
                  ? {
                    exec: discriminatorExec,
                    dependencyRegistry: discriminatorExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: discriminatorResult.consumed,
            };
          }
          // Zero-consumed discriminator + branch failure: propagate
          // the failure so optional()/withDefault() treat conditional
          // as unmatched.  The deferred discriminator path in complete()
          // handles resolution when needed.
          return branchParseResult;
        }
      }
      // Discriminator consumed tokens but completion failed (e.g.,
      // invalid choice value).  Propagate the error instead of
      // masking it behind the default branch or a generic no-match.
      if (discriminatorResult.consumed.length > 0) {
        return {
          success: false,
          consumed: discriminatorResult.consumed.length,
          error: completionResult.success
            ? getNoMatchError()
            : completionResult.error,
        };
      }
    }

    // Discriminator didn't match or didn't consume input, try default branch.
    // Only accept a zero-consuming default when the discriminator also
    // consumed nothing AND the buffer is empty; otherwise, the
    // discriminator's partial-match error or the construct's no-match
    // error is more informative and should be preserved.
    const discriminatorConsumed = discriminatorResult.success
      ? discriminatorResult.consumed.length
      : discriminatorResult.consumed;
    if (syncDefaultBranch !== undefined) {
      const defaultResult = syncDefaultBranch.parse(
        withChildContext(
          context,
          "_branch",
          state.branchState ?? syncDefaultBranch.initialState,
          syncDefaultBranch,
          syncDefaultBranch.usage,
        ),
      );

      if (
        defaultResult.success &&
        (defaultResult.consumed.length > 0 ||
          (discriminatorConsumed === 0 && context.buffer.length === 0))
      ) {
        const mergedExec = mergeChildExec(
          context.exec,
          defaultResult.next.exec,
        );
        // Commit the default when it consumed tokens OR when the
        // buffer is empty (no more input to parse, so committing is
        // safe and prevents complete() from re-evaluating lazy/
        // stateful discriminators that could pick a different branch).
        const commitDefault = defaultResult.consumed.length > 0 ||
          context.buffer.length === 0;
        return {
          success: true,
          ...(defaultResult.provisional ? { provisional: true as const } : {}),
          next: {
            ...defaultResult.next,
            state: {
              ...state,
              ...(commitDefault
                ? { selectedBranch: { kind: "default" as const } }
                : {}),
              branchState: getAnnotatedChildState(
                state,
                defaultResult.next.state,
                syncDefaultBranch,
              ),
            },
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: defaultResult.consumed,
        };
      }
      // Default branch consumed tokens before failing; propagate the
      // specific error instead of masking it behind a generic no-match.
      if (!defaultResult.success && defaultResult.consumed > 0) {
        return defaultResult;
      }
    }

    // Nothing matched
    return {
      success: false,
      consumed: 0,
      error: getNoMatchError(),
    };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<ConditionalState<string>>,
  ): Promise<ParseResult> => {
    const state = context.state ?? initialState;

    // If branch already selected, delegate to it
    if (state.selectedBranch !== undefined) {
      const branchParser = state.selectedBranch.kind === "default"
        ? defaultBranch!
        : branches[state.selectedBranch.key];

      const branchResult = await branchParser.parse(
        withChildContext(
          context,
          "_branch",
          state.branchState,
          branchParser,
          branchParser.usage,
        ),
      );

      if (branchResult.success) {
        const mergedExec = mergeChildExec(context.exec, branchResult.next.exec);
        return {
          success: true,
          // While `state.speculative` is set, the selection is still
          // tentative — the discriminator hasn't yet confirmed it.
          // Keep parse results provisional across subsequent calls so
          // outer combinators (or() / longestMatch()) don't treat the
          // unverified speculative selection as definitive.  The flag
          // is consulted (and locally cleared) during completion
          // verification — completeAsync() does not write the cleared
          // state back into parse-time state.
          ...((state.speculative || branchResult.provisional)
            ? { provisional: true as const }
            : {}),
          next: {
            ...branchResult.next,
            state: {
              ...state,
              branchState: getAnnotatedChildState(
                state,
                branchResult.next.state,
                branchParser,
              ),
            },
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: branchResult.consumed,
        };
      }
      return branchResult;
    }

    // Try to parse discriminator first
    const discriminatorResult = await discriminator.parse({
      ...withChildContext(
        context,
        "_discriminator",
        state.discriminatorState,
        discriminator,
      ),
    });

    if (discriminatorResult.success) {
      // For zero-consuming async discriminators, defer completion to
      // the complete phase to avoid triggering interactive side effects
      // (e.g., prompt()) during parse.  Sync discriminators are safe
      // to complete during parse even in the async path.
      //
      // Before deferring, try named branches speculatively, then fall
      // back to the default branch.  Named branches are tried first so
      // that a matching named branch is preferred over the default —
      // the discriminator can verify the speculative choice during
      // complete(), yielding a more specific result.
      if (
        discriminatorResult.consumed.length === 0 &&
        discriminator.$mode === "async"
      ) {
        // Try named branches speculatively: when the discriminator is
        // deferred, we don't know which branch to use, but if exactly one
        // branch can consume tokens from the buffer, commit to it
        // tentatively.  The complete phase will verify the choice against
        // the resolved discriminator value.  When multiple branches can
        // consume tokens (ambiguous), skip speculation entirely so that
        // branch selection stays order-independent.
        const discriminatorExec = mergeChildExec(
          context.exec,
          discriminatorResult.next.exec,
        );
        // Derive the speculation context from `discriminatorResult.next`
        // rather than the original `context`, so that any buffer or
        // optionsTerminated changes the discriminator made (without
        // consuming tokens) propagate to the branch probes.
        const speculationContext = {
          ...context,
          buffer: discriminatorResult.next.buffer,
          optionsTerminated: discriminatorResult.next.optionsTerminated,
          ...(discriminatorExec != null
            ? {
              exec: discriminatorExec,
              dependencyRegistry: discriminatorExec.dependencyRegistry,
            }
            : {}),
        };
        let speculativeHit: {
          key: string;
          bp: Parser<Mode, unknown, unknown>;
          result: ParserResult<unknown>;
        } | undefined;
        let provisionalHit: typeof speculativeHit;
        let provisionalAmbiguous = false;
        let speculativeError:
          | (ParserResult<unknown> & {
            success: false;
          })
          | undefined;
        let ambiguous = false;
        for (const [key, bp] of branchParsers) {
          const branchResult = await bp.parse(
            withChildContext(
              speculationContext,
              "_branch",
              bp.initialState,
              bp,
              bp.usage,
            ),
          );
          if (branchResult.success && branchResult.consumed.length > 0) {
            // Provisional results (e.g., from a nested speculative
            // conditional) don't count toward the definitive ambiguity
            // check but are tracked separately.  If multiple
            // provisional results exist, they are discarded to keep
            // branch selection order-independent.  Don't break — later
            // definitive branches must still be examined.
            if (branchResult.provisional) {
              if (provisionalHit == null && !provisionalAmbiguous) {
                provisionalHit = { key, bp, result: branchResult };
              } else {
                provisionalHit = undefined;
                provisionalAmbiguous = true;
              }
              continue;
            }
            if (speculativeHit != null) {
              ambiguous = true;
              break;
            }
            speculativeHit = { key, bp, result: branchResult };
          }
          // Track consuming failures for better error messages, but
          // keep trying other branches — a later branch may succeed
          // (e.g., flag("--x") vs option("--x", string())).
          if (
            !branchResult.success && branchResult.consumed > 0 &&
            (speculativeError == null ||
              speculativeError.consumed < branchResult.consumed)
          ) {
            speculativeError = branchResult;
          }
        }
        // When both a definitive and a provisional hit exist, the
        // correct choice depends on the unknown discriminator value.
        // Mark as ambiguous to avoid speculative commitment that may
        // lose valid parses.
        if (
          speculativeHit != null &&
          (provisionalHit != null || provisionalAmbiguous)
        ) {
          ambiguous = true;
        }
        // Fall back to a provisional hit (e.g., from a nested
        // speculative conditional) when no definitive hit was found
        // and provisional results were unambiguous.
        if (
          speculativeHit == null && !ambiguous && !provisionalAmbiguous &&
          provisionalHit != null
        ) {
          speculativeHit = provisionalHit;
        }
        if (speculativeHit != null && !ambiguous) {
          const { key, bp, result: branchResult } = speculativeHit;
          if (branchResult.success) {
            const annotatedDiscriminatorState = getAnnotatedChildState(
              state,
              discriminatorResult.next.state,
              discriminator,
            );
            const mergedExec = mergeChildExec(
              discriminatorExec,
              branchResult.next.exec,
            );
            return {
              success: true,
              provisional: true,
              next: {
                ...branchResult.next,
                state: {
                  ...state,
                  discriminatorState: annotatedDiscriminatorState,
                  selectedBranch: { kind: "branch", key },
                  branchState: getAnnotatedChildState(
                    state,
                    branchResult.next.state,
                    bp,
                  ),
                  speculative: true,
                },
                ...(mergedExec != null
                  ? {
                    exec: mergedExec,
                    dependencyRegistry: mergedExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: branchResult.consumed,
            };
          }
        }

        // No named branch consumed — fall back to the default branch.
        // Use speculationContext so the default branch sees any buffer
        // or optionsTerminated changes from the discriminator parse.
        //
        // Skip the default branch when speculation found multiple
        // candidates (definitive or provisional) but couldn't pick
        // one.  Committing to the default in that case would silently
        // discard the discriminator's eventual disambiguation among
        // the named branches.
        let deferredBranchState: unknown = state.branchState;
        if (
          defaultBranch !== undefined && !ambiguous && !provisionalAmbiguous
        ) {
          const defaultResult = await defaultBranch.parse(
            withChildContext(
              speculationContext,
              "_branch",
              state.branchState ?? defaultBranch.initialState,
              defaultBranch,
              defaultBranch.usage,
            ),
          );
          if (
            defaultResult.success &&
            defaultResult.consumed.length > 0
          ) {
            // Commit the default when it consumed tokens.
            const defaultExec = mergeChildExec(
              discriminatorExec ?? context.exec,
              defaultResult.next.exec,
            );
            return {
              success: true,
              ...(defaultResult.provisional
                ? { provisional: true as const }
                : {}),
              next: {
                ...defaultResult.next,
                state: {
                  ...state,
                  selectedBranch: { kind: "default" },
                  branchState: getAnnotatedChildState(
                    state,
                    defaultResult.next.state,
                    defaultBranch,
                  ),
                },
                ...(defaultExec != null
                  ? {
                    exec: defaultExec,
                    dependencyRegistry: defaultExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: defaultResult.consumed,
            };
          }
          if (!defaultResult.success && defaultResult.consumed > 0) {
            return defaultResult;
          }
          if (
            defaultResult.success &&
            defaultResult.consumed.length === 0 &&
            speculationContext.buffer.length === 0
          ) {
            deferredBranchState = getAnnotatedChildState(
              state,
              defaultResult.next.state,
              defaultBranch,
            );
          }
        }

        // A branch that consumed tokens before failing has a more
        // specific error than the generic stall the top-level loop
        // would produce.  Return it after the default branch has been
        // tried, and only when speculation was not skipped due to
        // either definitive or provisional ambiguity — otherwise the
        // returned error would be order-dependent and contradict the
        // ambiguity-skip intent.
        if (
          speculativeError != null && !ambiguous && !provisionalAmbiguous
        ) {
          return speculativeError;
        }

        const annotatedDiscriminatorState = getAnnotatedChildState(
          state,
          discriminatorResult.next.state,
          discriminator,
        );
        return {
          success: true,
          provisional: true,
          next: {
            ...speculationContext,
            state: {
              ...state,
              discriminatorState: annotatedDiscriminatorState,
              branchState: deferredBranchState,
            },
          },
          consumed: [],
        };
      }

      const annotatedDiscriminatorState = getAnnotatedChildState(
        state,
        discriminatorResult.next.state,
        discriminator,
      );
      // Complete discriminator to get the value
      const completionResult = await discriminator.complete(
        annotatedDiscriminatorState,
        withChildExecPath(context.exec, "_discriminator"),
      );

      if (completionResult.success) {
        const value = completionResult.value;
        const branchParser = branches[value];

        if (branchParser) {
          // Try to parse more from the branch
          const discriminatorExec = mergeChildExec(
            context.exec,
            discriminatorResult.next.exec,
          );
          const branchParseResult = await branchParser.parse({
            ...withChildContext(
              {
                ...context,
                ...(discriminatorExec != null
                  ? {
                    exec: discriminatorExec,
                    dependencyRegistry: discriminatorExec.dependencyRegistry,
                  }
                  : {}),
              },
              "_branch",
              branchParser.initialState,
              branchParser,
              branchParser.usage,
            ),
            buffer: discriminatorResult.next.buffer,
            optionsTerminated: discriminatorResult.next.optionsTerminated,
          });

          if (branchParseResult.success) {
            const mergedExec = mergeChildExec(
              discriminatorExec,
              branchParseResult.next.exec,
            );
            return {
              success: true,
              // See sync counterpart for isProvisional rationale.
              ...((branchParseResult.provisional ||
                  (discriminatorResult.consumed.length === 0 &&
                    branchParseResult.consumed.length === 0 &&
                    (branchParser.leadingNames.size > 0 ||
                      branchParser.acceptingAnyToken)))
                ? { provisional: true as const }
                : {}),
              next: {
                ...branchParseResult.next,
                state: {
                  discriminatorState: annotatedDiscriminatorState,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: getAnnotatedChildState(
                    state,
                    branchParseResult.next.state,
                    branchParser,
                  ),
                },
                ...(mergedExec != null
                  ? {
                    exec: mergedExec,
                    dependencyRegistry: mergedExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: [
                ...discriminatorResult.consumed,
                ...branchParseResult.consumed,
              ],
            };
          }

          // Branch parse failed but discriminator succeeded
          // (see sync counterpart for rationale).
          if (discriminatorResult.consumed.length > 0) {
            return {
              success: true,
              next: {
                ...discriminatorResult.next,
                state: {
                  discriminatorState: annotatedDiscriminatorState,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: getAnnotatedChildState(
                    state,
                    branchParser.initialState,
                    branchParser,
                  ),
                },
                ...(discriminatorExec != null
                  ? {
                    exec: discriminatorExec,
                    dependencyRegistry: discriminatorExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: discriminatorResult.consumed,
            };
          }
          // Zero-consumed discriminator + branch failure: propagate
          // the failure (see sync counterpart for rationale).
          return branchParseResult;
        }
      }
      // Discriminator consumed tokens but completion failed
      // (see sync counterpart for rationale).
      if (discriminatorResult.consumed.length > 0) {
        return {
          success: false,
          consumed: discriminatorResult.consumed.length,
          error: completionResult.success
            ? getNoMatchError()
            : completionResult.error,
        };
      }
    }

    // Discriminator didn't match or didn't consume input, try default branch
    // (see sync counterpart for rationale on the consumption/buffer guard).
    const discriminatorConsumed = discriminatorResult.success
      ? discriminatorResult.consumed.length
      : discriminatorResult.consumed;
    if (defaultBranch !== undefined) {
      const defaultResult = await defaultBranch.parse(
        withChildContext(
          context,
          "_branch",
          state.branchState ?? defaultBranch.initialState,
          defaultBranch,
          defaultBranch.usage,
        ),
      );

      if (
        defaultResult.success &&
        (defaultResult.consumed.length > 0 ||
          (discriminatorConsumed === 0 && context.buffer.length === 0))
      ) {
        const mergedExec = mergeChildExec(
          context.exec,
          defaultResult.next.exec,
        );
        // See sync counterpart for rationale on commitDefault.
        const commitDefault = defaultResult.consumed.length > 0 ||
          context.buffer.length === 0;
        return {
          success: true,
          ...(defaultResult.provisional ? { provisional: true as const } : {}),
          next: {
            ...defaultResult.next,
            state: {
              ...state,
              ...(commitDefault
                ? { selectedBranch: { kind: "default" as const } }
                : {}),
              branchState: getAnnotatedChildState(
                state,
                defaultResult.next.state,
                defaultBranch,
              ),
            },
            ...(mergedExec != null
              ? {
                exec: mergedExec,
                dependencyRegistry: mergedExec.dependencyRegistry,
              }
              : {}),
          },
          consumed: defaultResult.consumed,
        };
      }
      // See sync counterpart for rationale.
      if (!defaultResult.success && defaultResult.consumed > 0) {
        return defaultResult;
      }
    }

    // Nothing matched
    return {
      success: false,
      consumed: 0,
      error: getNoMatchError(),
    };
  };

  type CompleteResult = ValueParserResult<
    readonly [string | undefined, unknown]
  >;

  // Sync complete implementation
  const completeSync = (
    state: ConditionalState<string>,
    exec?: ExecutionContext,
  ): CompleteResult => {
    const syncDiscriminator = discriminator as Parser<"sync", string, unknown>;
    const syncDefaultBranch = defaultBranch as
      | Parser<"sync", unknown, unknown>
      | undefined;
    const syncBranches = branches as Record<
      string,
      Parser<"sync", unknown, unknown>
    >;

    // No branch selected yet — try completing the deferred discriminator,
    // then fall through to the default branch.  The sync path runs during
    // all phases (including parse-time probes from object/tuple/merge)
    // because sync discriminators are side-effect-free.  The async path
    // guards against parse/suggest phases to avoid triggering prompts.
    if (state.selectedBranch === undefined) {
      {
        const annotatedDiscriminatorStateForDeferred = getAnnotatedChildState(
          state,
          state.discriminatorState,
          syncDiscriminator,
        );
        const deferredDiscriminatorResult = unwrapCompleteResult(
          syncDiscriminator.complete(
            annotatedDiscriminatorStateForDeferred,
            withChildExecPath(exec, "_discriminator"),
          ),
        );
        if (deferredDiscriminatorResult.success) {
          const deferredValue = deferredDiscriminatorResult.value as string;
          const deferredBranch = syncBranches[deferredValue];
          if (deferredBranch) {
            const branchExec = withChildExecPath(exec, "_branch");
            const emptyCtx = {
              buffer: [] as string[],
              optionsTerminated: false,
              usage: [] as never[],
              exec: branchExec,
              dependencyRegistry: exec?.dependencyRegistry,
            };
            const annotatedInitial = getAnnotatedChildState(
              state,
              deferredBranch.initialState,
              deferredBranch,
            );
            const replayResult = deferredBranch.parse({
              ...emptyCtx,
              state: annotatedInitial,
            });
            const branchState = replayResult.success
              ? replayResult.next.state
              : annotatedInitial;
            // Re-inject parent annotations for the complete phase
            // so that inherited-annotation parsers (e.g., bindConfig)
            // see annotations after the replay parse.
            const annotatedBranchState = getAnnotatedChildState(
              state,
              branchState,
              deferredBranch,
            );
            const branchResult = unwrapCompleteResult(
              deferredBranch.complete(
                annotatedBranchState,
                branchExec,
              ),
            );
            if (branchResult.success) {
              return {
                success: true,
                value: [deferredValue, branchResult.value] as const,
                ...(branchResult.deferred
                  ? {
                    deferred: true as const,
                    ...(branchResult.deferredKeys
                      ? {
                        deferredKeys: new Map([[
                          1,
                          branchResult.deferredKeys,
                        ]]) as DeferredMap,
                      }
                      : branchResult.value == null ||
                          typeof branchResult.value !== "object"
                      ? {
                        deferredKeys: new Map([[
                          1,
                          null,
                        ]]) as DeferredMap,
                      }
                      : {}),
                  }
                  : {}),
              };
            }
            if (options?.errors?.branchError) {
              return {
                success: false,
                error: options.errors.branchError(
                  deferredValue,
                  branchResult.error,
                ),
              };
            }
            return branchResult;
          }
          // Discriminator resolved but branch not found — use noMatch.
          if (syncDefaultBranch === undefined) {
            return {
              success: false,
              error: getNoMatchError(),
            };
          }
        } else if (syncDefaultBranch === undefined) {
          // Discriminator failed and no default — surface the error.
          return deferredDiscriminatorResult;
        }
      }

      // Fall through to the default branch (accessible during all
      // phases, including parse-time probes).
      if (syncDefaultBranch !== undefined) {
        const branchState = getAnnotatedChildState(
          state,
          state.branchState ?? syncDefaultBranch.initialState,
          syncDefaultBranch,
        );
        const defaultResult = unwrapCompleteResult(
          syncDefaultBranch.complete(
            branchState,
            withChildExecPath(exec, "_branch"),
          ),
        );
        if (!defaultResult.success) {
          return defaultResult;
        }
        return {
          success: true,
          value: [undefined, defaultResult.value] as const,
          ...(defaultResult.deferred
            ? {
              deferred: true as const,
              ...(defaultResult.deferredKeys
                ? {
                  deferredKeys: new Map([[
                    1,
                    defaultResult.deferredKeys,
                  ]]) as DeferredMap,
                }
                : defaultResult.value == null ||
                    typeof defaultResult.value !== "object"
                ? { deferredKeys: new Map([[1, null]]) as DeferredMap }
                : {}),
            }
            : {}),
        };
      }

      return {
        success: false,
        error: message`Missing required discriminator option.`,
      };
    }
    const branchParser = state.selectedBranch.kind === "default"
      ? syncDefaultBranch!
      : syncBranches[state.selectedBranch.key];
    const annotatedDiscriminatorState = getAnnotatedChildState(
      state,
      state.discriminatorState,
      syncDiscriminator,
    );
    const combinedState = {
      _discriminator: annotatedDiscriminatorState,
      _branch: getAnnotatedChildState(
        state,
        state.branchState,
        branchParser,
      ),
    };
    const runtime = createDependencyRuntimeContext(
      exec?.dependencyRegistry?.clone(),
    );
    collectExplicitSourceValues(
      buildRuntimeNodesFromPairs(
        [
          ["_discriminator", discriminator],
          ["_branch", branchParser],
        ],
        combinedState,
        exec?.path,
      ),
      runtime,
    );
    collectSourcesFromState(combinedState, runtime);
    const resolvedBranchState = getAnnotatedChildState(
      state,
      resolveStateWithRuntime(state.branchState, runtime),
      branchParser,
    );
    const completionExec: ExecutionContext = {
      ...(exec ?? {
        usage: branchParser.usage,
        path: [],
        trace: undefined,
      }),
      phase: "complete",
      dependencyRuntime: runtime,
      dependencyRegistry: runtime.registry,
    };
    // Only complete the discriminator when needed — skip re-completion
    // when the cached discriminatorValue already matches the selected
    // branch key, avoiding side effects from non-idempotent discriminators.
    const needsDiscriminatorCompletion = state.selectedBranch.kind !==
        "default" &&
      !(state.discriminatorValue != null &&
        state.discriminatorValue === state.selectedBranch.key);
    const discriminatorCompleteResult = needsDiscriminatorCompletion
      ? syncDiscriminator.complete(
        annotatedDiscriminatorState,
        withChildExecPath(completionExec, "_discriminator"),
      )
      : undefined;

    const branchResult = unwrapCompleteResult(
      branchParser.complete(
        resolvedBranchState,
        withChildExecPath(completionExec, "_branch"),
      ),
    );

    if (!branchResult.success) {
      if (
        state.discriminatorValue !== undefined &&
        options?.errors?.branchError
      ) {
        return {
          success: false,
          error: options.errors.branchError(
            state.discriminatorValue,
            branchResult.error,
          ),
        };
      }
      return branchResult;
    }

    let discriminatorValue: string | undefined;
    if (state.selectedBranch.kind === "default") {
      discriminatorValue = undefined;
    } else if (
      state.discriminatorValue != null &&
      state.discriminatorValue === state.selectedBranch.key
    ) {
      discriminatorValue = state.discriminatorValue;
    } else {
      const completedDiscriminator = unwrapCompleteResult(
        discriminatorCompleteResult,
      );
      discriminatorValue = completedDiscriminator.success
        ? completedDiscriminator.value as string
        : state.selectedBranch.key;
    }

    return {
      success: true,
      value: [discriminatorValue, branchResult.value] as const,
      // Propagate deferred metadata from the branch result,
      // remapping to index 1 of the [discriminator, branchValue] tuple.
      ...(branchResult.deferred
        ? {
          deferred: true as const,
          ...(branchResult.deferredKeys
            ? {
              deferredKeys: new Map([[
                1,
                branchResult.deferredKeys,
              ]]) as DeferredMap,
            }
            : branchResult.value == null ||
                typeof branchResult.value !== "object"
            ? { deferredKeys: new Map([[1, null]]) as DeferredMap }
            : {}),
        }
        : {}),
    };
  };

  // Async complete implementation
  const completeAsync = async (
    state: ConditionalState<string>,
    exec?: ExecutionContext,
  ): Promise<CompleteResult> => {
    // When a branch was selected speculatively (async discriminator
    // deferred, but a named branch consumed tokens during parse),
    // let the normal selected-branch path handle discriminator
    // completion so that it runs with the dependency runtime.  We
    // only record a flag here and perform the mismatch check after
    // the discriminator has been properly completed below.
    let wasSpeculative = false;
    if (state.speculative && state.selectedBranch?.kind === "branch") {
      if (exec?.phase !== "parse" && exec?.phase !== "suggest") {
        // Real complete: clear speculative; leave discriminatorValue
        // undefined so the normal path completes the discriminator
        // with the dependency runtime.
        wasSpeculative = true;
        state = { ...state, speculative: undefined };
      } else {
        // Parse/suggest probe (e.g., object()'s allCanComplete check):
        // do NOT call discriminator.complete() OR branchParser.complete().
        // Both may have deferred side effects (e.g., prompt(), bindEnv).
        // The probe consumer only inspects `success`, so return success
        // with a placeholder value built from the speculative key.  The
        // real complete pass (phase="complete") will run the branch and
        // verify the discriminator.
        return {
          success: true,
          value: [state.selectedBranch.key, undefined] as const,
        };
      }
    }

    // No branch selected yet (see sync counterpart for rationale).
    if (state.selectedBranch === undefined) {
      if (exec?.phase !== "parse" && exec?.phase !== "suggest") {
        const annotatedDiscriminatorStateForDeferred = getAnnotatedChildState(
          state,
          state.discriminatorState,
          discriminator,
        );
        const deferredDiscriminatorResult = unwrapCompleteResult(
          await discriminator.complete(
            annotatedDiscriminatorStateForDeferred,
            withChildExecPath(exec, "_discriminator"),
          ),
        );
        if (deferredDiscriminatorResult.success) {
          const deferredValue = deferredDiscriminatorResult.value as string;
          const deferredBranch = branches[deferredValue];
          if (deferredBranch) {
            const branchExec = withChildExecPath(exec, "_branch");
            const emptyCtx = {
              buffer: [] as string[],
              optionsTerminated: false,
              usage: [] as never[],
              exec: branchExec,
              dependencyRegistry: exec?.dependencyRegistry,
            };
            const annotatedInitial = getAnnotatedChildState(
              state,
              deferredBranch.initialState,
              deferredBranch,
            );
            const replayResult = await deferredBranch.parse({
              ...emptyCtx,
              state: annotatedInitial,
            });
            const branchState = replayResult.success
              ? replayResult.next.state
              : annotatedInitial;
            // Re-inject parent annotations for the complete phase
            // (see sync counterpart for rationale).
            const annotatedBranchState = getAnnotatedChildState(
              state,
              branchState,
              deferredBranch,
            );
            const branchResult = unwrapCompleteResult(
              await deferredBranch.complete(
                annotatedBranchState,
                branchExec,
              ),
            );
            if (branchResult.success) {
              return {
                success: true,
                value: [deferredValue, branchResult.value] as const,
                ...(branchResult.deferred
                  ? {
                    deferred: true as const,
                    ...(branchResult.deferredKeys
                      ? {
                        deferredKeys: new Map([[
                          1,
                          branchResult.deferredKeys,
                        ]]) as DeferredMap,
                      }
                      : branchResult.value == null ||
                          typeof branchResult.value !== "object"
                      ? {
                        deferredKeys: new Map([[
                          1,
                          null,
                        ]]) as DeferredMap,
                      }
                      : {}),
                  }
                  : {}),
              };
            }
            if (options?.errors?.branchError) {
              return {
                success: false,
                error: options.errors.branchError(
                  deferredValue,
                  branchResult.error,
                ),
              };
            }
            return branchResult;
          }
          if (defaultBranch === undefined) {
            return {
              success: false,
              error: getNoMatchError(),
            };
          }
        } else if (defaultBranch === undefined) {
          return deferredDiscriminatorResult;
        }
      }

      // Parse/suggest probe with no branch selected: do NOT call
      // defaultBranch.complete() OR discriminator.complete() — both
      // may contain side-effecting completers (e.g., prompt(), bindEnv)
      // that should only fire during the real complete pass.  This
      // applies whether or not a default branch is configured: when
      // there is no default and the discriminator is deferred (e.g.,
      // an async prompt()), the probe must still succeed so the
      // parent combinator (object()'s allCanComplete check, etc.)
      // doesn't bail out before the real complete phase has a chance
      // to resolve the discriminator interactively.  The probe
      // consumer only inspects `success`, so return success with a
      // placeholder value.
      if (exec?.phase === "parse" || exec?.phase === "suggest") {
        return {
          success: true,
          value: [undefined, undefined] as const,
        };
      }

      // Default branch (real complete only).
      if (defaultBranch !== undefined) {
        const branchState = getAnnotatedChildState(
          state,
          state.branchState ?? defaultBranch.initialState,
          defaultBranch,
        );
        const defaultResult = unwrapCompleteResult(
          await defaultBranch.complete(
            branchState,
            withChildExecPath(exec, "_branch"),
          ),
        );
        if (!defaultResult.success) {
          return defaultResult;
        }
        return {
          success: true,
          value: [undefined, defaultResult.value] as const,
          ...(defaultResult.deferred
            ? {
              deferred: true as const,
              ...(defaultResult.deferredKeys
                ? {
                  deferredKeys: new Map([[
                    1,
                    defaultResult.deferredKeys,
                  ]]) as DeferredMap,
                }
                : defaultResult.value == null ||
                    typeof defaultResult.value !== "object"
                ? { deferredKeys: new Map([[1, null]]) as DeferredMap }
                : {}),
            }
            : {}),
        };
      }

      return {
        success: false,
        error: message`Missing required discriminator option.`,
      };
    }
    const branchParser = state.selectedBranch.kind === "default"
      ? defaultBranch!
      : branches[state.selectedBranch.key];
    const annotatedDiscriminatorState = getAnnotatedChildState(
      state,
      state.discriminatorState,
      discriminator,
    );
    const combinedState = {
      _discriminator: annotatedDiscriminatorState,
      _branch: getAnnotatedChildState(
        state,
        state.branchState,
        branchParser,
      ),
    };
    const runtime = createDependencyRuntimeContext(
      exec?.dependencyRegistry?.clone(),
    );
    await collectExplicitSourceValuesAsync(
      buildRuntimeNodesFromPairs(
        [
          ["_discriminator", discriminator],
          ["_branch", branchParser],
        ],
        combinedState,
        exec?.path,
      ),
      runtime,
    );
    collectSourcesFromState(combinedState, runtime);
    // The branch state may carry deferred dependency parsing
    // (DeferredParseState).  Resolving it before the speculative
    // mismatch check would replay parseWithDependency for the *wrong*
    // branch in mismatch cases, potentially throwing or running side
    // effects that should have been pre-empted by the mismatch error.
    // The resolve step is therefore deferred until after the mismatch
    // check below — see `resolvedBranchState` further down.
    const completionExec: ExecutionContext = {
      ...(exec ?? {
        usage: branchParser.usage,
        path: [],
        trace: undefined,
      }),
      phase: "complete",
      dependencyRuntime: runtime,
      dependencyRegistry: runtime.registry,
    };
    // Only complete the discriminator when needed
    // (see sync counterpart for rationale).
    const needsDiscriminatorCompletion = state.selectedBranch.kind !==
        "default" &&
      !(state.discriminatorValue != null &&
        state.discriminatorValue === state.selectedBranch.key);
    // For speculative verification, complete the discriminator with
    // a runtime that ONLY contains discriminator-side sources.  In
    // the non-speculative path, the branch was selected by the
    // discriminator at parse time and the combined runtime is fine.
    // In the speculative path (`wasSpeculative`), the chosen branch
    // is just a guess: if `discriminator.complete()` could see the
    // speculative branch's dependency sources, a branch that exposes
    // the same source key as the discriminator could circularly
    // confirm itself.  Build a discriminator-only runtime so that
    // the verification is independent of branch-local sources.
    let discriminatorCompletionExec = completionExec;
    if (wasSpeculative && needsDiscriminatorCompletion) {
      const discOnlyState = { _discriminator: annotatedDiscriminatorState };
      const discOnlyRuntime = createDependencyRuntimeContext(
        exec?.dependencyRegistry?.clone(),
      );
      await collectExplicitSourceValuesAsync(
        buildRuntimeNodesFromPairs(
          [["_discriminator", discriminator]] as const,
          discOnlyState,
          exec?.path,
        ),
        discOnlyRuntime,
      );
      collectSourcesFromState(discOnlyState, discOnlyRuntime);
      discriminatorCompletionExec = {
        ...completionExec,
        dependencyRuntime: discOnlyRuntime,
        dependencyRegistry: discOnlyRuntime.registry,
      };
    }
    const discriminatorCompleteResult = needsDiscriminatorCompletion
      ? await discriminator.complete(
        annotatedDiscriminatorState,
        withChildExecPath(discriminatorCompletionExec, "_discriminator"),
      )
      : undefined;

    // Determine the discriminator value before completing the branch
    // so speculative mismatch is caught early, preventing errors from
    // the wrong branch (e.g., "missing --extra") from leaking out.
    let discriminatorValue: string | undefined;
    if (state.selectedBranch.kind === "default") {
      discriminatorValue = undefined;
    } else if (
      state.discriminatorValue != null &&
      state.discriminatorValue === state.selectedBranch.key
    ) {
      discriminatorValue = state.discriminatorValue;
    } else {
      const completedDiscriminator = unwrapCompleteResult(
        discriminatorCompleteResult,
      );
      if (completedDiscriminator.success) {
        discriminatorValue = completedDiscriminator.value as string;
      } else if (wasSpeculative) {
        // The discriminator never confirmed the speculative branch —
        // propagate the failure instead of silently falling back to
        // the guessed key.
        return completedDiscriminator;
      } else {
        discriminatorValue = state.selectedBranch.key;
      }
    }

    // When the branch was selected speculatively, verify that the
    // resolved discriminator value matches.  A mismatch means
    // contradictory input (e.g., --threads provided but discriminator
    // resolved to "slow").  The speculative branch already consumed
    // tokens during parse, so recovery is not possible — the tokens
    // are committed to the wrong branch.
    if (
      wasSpeculative &&
      state.selectedBranch.kind === "branch" &&
      discriminatorValue !== state.selectedBranch.key
    ) {
      const speculativeKey = state.selectedBranch.key;
      // `discriminatorValue` is statically `string | undefined`.  In
      // this branch it should always be a string (the only path that
      // sets `undefined` is the default-branch case, which is excluded
      // by the `kind === "branch"` guard above).  Defensively coerce
      // anyway: a buggy discriminator that violates its return-type
      // contract by yielding a non-string would otherwise produce a
      // confusing "resolved to ." message in both the default error
      // and the `branchMismatch` hook.
      const resolvedKey = typeof discriminatorValue === "string"
        ? discriminatorValue
        : "<unknown>";
      return {
        success: false,
        error: options?.errors?.branchMismatch
          ? options.errors.branchMismatch(resolvedKey, speculativeKey)
          : message`Branch mismatch: tokens for ${speculativeKey} were consumed, but the discriminator resolved to ${resolvedKey}.`,
      };
    }

    // Now that the speculative branch (if any) is verified, it is
    // safe to replay deferred dependency parsing for the chosen
    // branch state.  Doing this before the mismatch check above
    // would have run parseWithDependency for the wrong branch.
    const resolvedBranchState = getAnnotatedChildState(
      state,
      await resolveStateWithRuntimeAsync(state.branchState, runtime),
      branchParser,
    );

    const branchResult = unwrapCompleteResult(
      await branchParser.complete(
        resolvedBranchState,
        withChildExecPath(completionExec, "_branch"),
      ),
    );

    if (!branchResult.success) {
      if (
        discriminatorValue !== undefined &&
        options?.errors?.branchError
      ) {
        return {
          success: false,
          error: options.errors.branchError(
            discriminatorValue,
            branchResult.error,
          ),
        };
      }
      return branchResult;
    }

    return {
      success: true,
      value: [discriminatorValue, branchResult.value] as const,
      ...(branchResult.deferred
        ? {
          deferred: true as const,
          ...(branchResult.deferredKeys
            ? {
              deferredKeys: new Map([[
                1,
                branchResult.deferredKeys,
              ]]) as DeferredMap,
            }
            : branchResult.value == null ||
                typeof branchResult.value !== "object"
            ? { deferredKeys: new Map([[1, null]]) as DeferredMap }
            : {}),
        }
        : {}),
    };
  };

  // Sync suggest implementation
  function* suggestSync(
    context: ParserContext<ConditionalState<string>>,
    prefix: string,
  ): Iterable<Suggestion> {
    const state = context.state ?? initialState;
    const syncDiscriminator = discriminator as Parser<"sync", string, unknown>;
    const syncBranches = branches as Record<
      string,
      Parser<"sync", unknown, unknown>
    >;
    const syncDefaultBranch = defaultBranch as
      | Parser<"sync", unknown, unknown>
      | undefined;

    // If no branch selected, suggest discriminator and default branch options
    if (state.selectedBranch === undefined) {
      const runtime = createDependencyRuntimeContext(
        context.dependencyRegistry?.clone(),
      );
      const annotatedDiscriminatorState = getAnnotatedChildState(
        state,
        state.discriminatorState,
        syncDiscriminator,
      );
      const defaultCombinedState = {
        _discriminator: annotatedDiscriminatorState,
        _branch: syncDefaultBranch == null
          ? state.branchState
          : getAnnotatedChildState(
            state,
            state.branchState,
            syncDefaultBranch,
          ),
      };
      collectExplicitSourceValues(
        buildRuntimeNodesFromPairs(
          syncDefaultBranch == null
            ? [["\u005fdiscriminator", discriminator]] as const
            : [
              ["\u005fdiscriminator", discriminator],
              ["\u005fbranch", syncDefaultBranch],
            ] as const,
          defaultCombinedState,
          context.exec?.path,
        ),
        runtime,
      );
      collectSourcesFromState(defaultCombinedState, runtime);
      const suggestContext = {
        ...context,
        dependencyRegistry: runtime.registry,
        ...(context.exec != null
          ? {
            exec: {
              ...context.exec,
              dependencyRuntime: runtime,
              dependencyRegistry: runtime.registry,
            },
          }
          : {}),
      };
      // Discriminator suggestions
      yield* syncDiscriminator.suggest(
        withChildContext(
          suggestContext,
          "_discriminator",
          state.discriminatorState,
          syncDiscriminator,
        ),
        prefix,
      );

      // Try resolving the discriminator to show branch suggestions
      // for zero-consuming discriminators (e.g., constant("key")).
      const annotatedDiscState = getAnnotatedChildState(
        state,
        state.discriminatorState,
        syncDiscriminator,
      );
      const discComplete = syncDiscriminator.complete(
        annotatedDiscState,
        withChildExecPath(
          suggestContext.exec
            ? { ...suggestContext.exec, phase: "suggest" }
            : undefined,
          "_discriminator",
        ),
      );
      if (
        discComplete.success &&
        syncBranches[discComplete.value] !== undefined
      ) {
        const resolvedBranch = syncBranches[discComplete.value];
        yield* resolvedBranch.suggest(
          withChildContext(
            suggestContext,
            "_branch",
            state.branchState ?? resolvedBranch.initialState,
            resolvedBranch,
          ),
          prefix,
        );
      } else if (syncDefaultBranch !== undefined) {
        // Default branch suggestions if available
        yield* syncDefaultBranch.suggest(
          withChildContext(
            suggestContext,
            "_branch",
            state.branchState ?? syncDefaultBranch.initialState,
            syncDefaultBranch,
          ),
          prefix,
        );
      }
    } else {
      // Delegate to selected branch
      const branchParser = state.selectedBranch.kind === "default"
        ? syncDefaultBranch!
        : syncBranches[state.selectedBranch.key];
      const runtime = createDependencyRuntimeContext(
        context.dependencyRegistry?.clone(),
      );
      const annotatedDiscriminatorState = getAnnotatedChildState(
        state,
        state.discriminatorState,
        syncDiscriminator,
      );
      const combinedState = {
        _discriminator: annotatedDiscriminatorState,
        _branch: getAnnotatedChildState(
          state,
          state.branchState,
          branchParser,
        ),
      };
      collectExplicitSourceValues(
        buildRuntimeNodesFromPairs(
          [
            ["_discriminator", discriminator],
            ["_branch", branchParser],
          ],
          combinedState,
          context.exec?.path,
        ),
        runtime,
      );
      collectSourcesFromState(combinedState, runtime);
      const suggestContext = {
        ...context,
        dependencyRegistry: runtime.registry,
        ...(context.exec != null
          ? {
            exec: {
              ...context.exec,
              dependencyRuntime: runtime,
              dependencyRegistry: runtime.registry,
            },
          }
          : {}),
      };

      yield* branchParser.suggest(
        withChildContext(
          suggestContext,
          "_branch",
          state.branchState,
          branchParser,
        ),
        prefix,
      );
    }
  }

  // Async suggest implementation
  async function* suggestAsync(
    context: ParserContext<ConditionalState<string>>,
    prefix: string,
  ): AsyncIterable<Suggestion> {
    const state = context.state ?? initialState;

    // If no branch selected, suggest discriminator and default branch options
    if (state.selectedBranch === undefined) {
      const runtime = createDependencyRuntimeContext(
        context.dependencyRegistry?.clone(),
      );
      const annotatedDiscriminatorState = getAnnotatedChildState(
        state,
        state.discriminatorState,
        discriminator,
      );
      const defaultCombinedState = {
        _discriminator: annotatedDiscriminatorState,
        _branch: defaultBranch == null
          ? state.branchState
          : getAnnotatedChildState(
            state,
            state.branchState,
            defaultBranch,
          ),
      };
      await collectExplicitSourceValuesAsync(
        buildRuntimeNodesFromPairs(
          defaultBranch == null
            ? [["\u005fdiscriminator", discriminator]] as const
            : [
              ["\u005fdiscriminator", discriminator],
              ["\u005fbranch", defaultBranch],
            ] as const,
          defaultCombinedState,
          context.exec?.path,
        ),
        runtime,
      );
      collectSourcesFromState(defaultCombinedState, runtime);
      const suggestContext = {
        ...context,
        dependencyRegistry: runtime.registry,
        ...(context.exec != null
          ? {
            exec: {
              ...context.exec,
              dependencyRuntime: runtime,
              dependencyRegistry: runtime.registry,
            },
          }
          : {}),
      };
      // Discriminator suggestions
      yield* discriminator.suggest(
        withChildContext(
          suggestContext,
          "_discriminator",
          state.discriminatorState,
          discriminator,
        ),
        prefix,
      );

      // Try resolving the discriminator for branch suggestions
      // (see sync counterpart for rationale).  Only attempt completion
      // for sync discriminators — async ones (e.g., prompt()) may
      // trigger side effects that are unsafe during suggest.
      let discResolved = false;
      if (discriminator.$mode === "sync") {
        const annotatedDiscState = getAnnotatedChildState(
          state,
          state.discriminatorState,
          discriminator,
        );
        const discComplete = discriminator.complete(
          annotatedDiscState,
          withChildExecPath(
            suggestContext.exec
              ? { ...suggestContext.exec, phase: "suggest" }
              : undefined,
            "_discriminator",
          ),
        ) as ValueParserResult<string>;
        if (
          discComplete.success &&
          branches[discComplete.value] !== undefined
        ) {
          const resolvedBranch = branches[discComplete.value];
          yield* resolvedBranch.suggest(
            withChildContext(
              suggestContext,
              "_branch",
              state.branchState ?? resolvedBranch.initialState,
              resolvedBranch,
            ),
            prefix,
          );
          discResolved = true;
        }
      }
      if (!discResolved) {
        if (defaultBranch !== undefined) {
          yield* defaultBranch.suggest(
            withChildContext(
              suggestContext,
              "_branch",
              state.branchState ?? defaultBranch.initialState,
              defaultBranch,
            ),
            prefix,
          );
        }
      }
    } else {
      // Delegate to selected branch
      const branchParser = state.selectedBranch.kind === "default"
        ? defaultBranch!
        : branches[state.selectedBranch.key];
      const runtime = createDependencyRuntimeContext(
        context.dependencyRegistry?.clone(),
      );
      const annotatedDiscriminatorState = getAnnotatedChildState(
        state,
        state.discriminatorState,
        discriminator,
      );
      const combinedState = {
        _discriminator: annotatedDiscriminatorState,
        _branch: getAnnotatedChildState(
          state,
          state.branchState,
          branchParser,
        ),
      };
      await collectExplicitSourceValuesAsync(
        buildRuntimeNodesFromPairs(
          [
            ["_discriminator", discriminator],
            ["_branch", branchParser],
          ],
          combinedState,
          context.exec?.path,
        ),
        runtime,
      );
      collectSourcesFromState(combinedState, runtime);
      const suggestContext = {
        ...context,
        dependencyRegistry: runtime.registry,
        ...(context.exec != null
          ? {
            exec: {
              ...context.exec,
              dependencyRuntime: runtime,
              dependencyRegistry: runtime.registry,
            },
          }
          : {}),
      };

      yield* branchParser.suggest(
        withChildContext(
          suggestContext,
          "_branch",
          state.branchState,
          branchParser,
        ),
        prefix,
      );
    }
  }

  const conditionalParser = {
    $mode: combinedMode,
    $valueType: [],
    $stateType: [],
    priority: maxPriority,
    usage,
    // The default branch receives the original buffer both when the
    // discriminator fails outright AND when it succeeds but its value
    // does not match any branch key.  In either case the default
    // branch's leading names are reachable at position 0.
    leadingNames: defaultBranch
      ? unionLeadingNames([discriminator, defaultBranch])
      : discriminator.leadingNames,
    // A catch-all default branch makes the conditional consume any
    // positional token at argv[0], because the default branch reparses
    // the original buffer when the discriminator does not select a
    // concrete branch.  The discriminator's own catch-all status does
    // not matter here: it only routes to branches, not to the default.
    acceptingAnyToken: defaultBranch?.acceptingAnyToken ?? false,
    initialState,

    parse(context) {
      if (isAsync) {
        return parseAsync(context);
      }
      return parseSync(context);
    },

    complete(state, exec?) {
      if (isAsync) {
        return completeAsync(state, exec);
      }
      return completeSync(state, exec);
    },

    suggest(context, prefix) {
      if (isAsync) {
        return suggestAsync(context, prefix);
      }
      return suggestSync(context, prefix);
    },

    getDocFragments(_state, _defaultValue?) {
      const fragments: DocFragment[] = [];

      // Add discriminator documentation
      const discriminatorFragments = discriminator.getDocFragments(
        { kind: "unavailable" },
        undefined,
      );
      fragments.push(...discriminatorFragments.fragments);

      // Add branch-specific documentation
      for (const [key, branchParser] of branchParsers) {
        const branchFragments = branchParser.getDocFragments(
          { kind: "unavailable" },
          undefined,
        );

        const entries: DocEntry[] = branchFragments.fragments
          .filter((f): f is DocEntry & { type: "entry" } => f.type === "entry");

        // Also collect entries from sections
        for (const fragment of branchFragments.fragments) {
          if (fragment.type === "section") {
            entries.push(...fragment.entries);
          }
        }

        if (entries.length > 0) {
          fragments.push({
            type: "section",
            title: `Options when ${key}`,
            entries,
          });
        }
      }

      // Add default branch documentation if present
      if (defaultBranch !== undefined) {
        const defaultFragments = defaultBranch.getDocFragments(
          { kind: "unavailable" },
          undefined,
        );

        const entries: DocEntry[] = defaultFragments.fragments
          .filter((f): f is DocEntry & { type: "entry" } => f.type === "entry");

        for (const fragment of defaultFragments.fragments) {
          if (fragment.type === "section") {
            entries.push(...fragment.entries);
          }
        }

        if (entries.length > 0) {
          fragments.push({
            type: "section",
            title: "Default options",
            entries,
          });
        }
      }

      return { fragments };
    },
  } as Parser<
    Mode,
    readonly [string | undefined, unknown],
    ConditionalState<string>
  >;
  defineInheritedAnnotationParser(conditionalParser);
  return conditionalParser;
}
