import {
  createDependencySourceState,
  type DeferredParseState,
  dependencyId,
  DependencyRegistry,
  isDeferredParseState,
  isDependencySourceState,
  isPendingDependencySourceState,
  isWrappedDependencySource,
  parseWithDependency,
  wrappedDependencySourceMarker,
} from "./dependency.ts";
import {
  buildRuntimeNodesFromPairs,
  collectExplicitSourceValues,
  createDependencyRuntimeContext,
  fillMissingSourceDefaults,
  fillMissingSourceDefaultsAsync,
  resolveStateWithRuntime,
  resolveStateWithRuntimeAsync,
} from "./dependency-runtime.ts";
import {
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
} from "./annotations.ts";
import { dispatchByMode, dispatchIterableByMode } from "./mode-dispatch.ts";
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
  Parser,
  ParserContext,
  ParserResult,
  Suggestion,
} from "./parser.ts";

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

const inheritParentAnnotationsKey = Symbol.for(
  "@optique/core/inheritParentAnnotations",
);

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
function unwrapCompleteResult(
  result: unknown,
): import("./valueparser.ts").ValueParserResult<unknown> {
  if (isDependencySourceState(result)) return result.result;
  return result as import("./valueparser.ts").ValueParserResult<unknown>;
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
 * the parser's {@link inheritParentAnnotationsKey} flag.  This is the
 * same logic as {@link createFieldStateGetter} inside `object()` but
 * without the per-state cache, for use in module-level helpers like
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
  if (sourceState == null || typeof sourceState !== "object") {
    return sourceState;
  }
  const annotations = getAnnotations(parentState);
  if (
    annotations === undefined || getAnnotations(sourceState) === annotations
  ) {
    return sourceState;
  }
  return Reflect.get(parser, inheritParentAnnotationsKey) === true
    ? injectAnnotations(sourceState, annotations)
    : inheritAnnotations(parentState, sourceState);
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
    if (state == null) {
      return {
        success: false,
        error: getNoMatchError(options, noMatchContext),
      };
    }
    const [i, result] = state;
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return dispatchByMode(
      mode,
      () => syncParsers[i].complete(result.next.state, exec),
      async () => {
        const completeResult = await parsers[i].complete(
          result.next.state,
          exec,
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

        if (context.state == null) {
          // No parser has been selected yet, get suggestions from all parsers
          for (const parser of syncParsers) {
            const parserSuggestions = parser.suggest({
              ...context,
              state: parser.initialState,
            }, prefix);
            suggestions.push(...parserSuggestions);
          }
        } else {
          // A parser has been selected, delegate to that parser
          const [index, parserResult] = context.state;
          if (parserResult.success) {
            const parserSuggestions = syncParsers[index].suggest({
              ...context,
              state: parserResult.next.state,
            }, prefix);
            suggestions.push(...parserSuggestions);
          }
        }

        yield* deduplicateSuggestions(suggestions);
      },
      async function* () {
        const suggestions: Suggestion[] = [];

        if (context.state == null) {
          // No parser has been selected yet, get suggestions from all parsers
          for (const parser of parsers) {
            const parserSuggestions = parser.suggest({
              ...context,
              state: parser.initialState,
            }, prefix);
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
          const [index, parserResult] = context.state;
          if (parserResult.success) {
            const parser = parsers[index];
            const parserSuggestions = parser.suggest({
              ...context,
              state: parserResult.next.state,
            }, prefix);
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
    const orderedParsers = syncParsers.map((p, i) =>
      [p, i] as [Parser<"sync", unknown, unknown>, number]
    );
    orderedParsers.sort(([_, a], [__, b]) =>
      context.state?.[0] === a ? -1 : context.state?.[0] === b ? 1 : a - b
    );
    for (const [parser, i] of orderedParsers) {
      const result = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });
      if (result.success && result.consumed.length > 0) {
        if (context.state?.[0] !== i && context.state?.[1].success) {
          // Different branch succeeded. Check if the new branch can also
          // consume the previously consumed input (shared options case).
          const previouslyConsumed = context.state[1].consumed;
          const checkResult = parser.parse({
            ...context,
            buffer: previouslyConsumed,
            state: parser.initialState,
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
              error: message`${values(context.state[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
            };
          }
          // Branch switch allowed - re-parse current input with state from
          // shared options to ensure dependency values are available.
          const replayedResult = parser.parse({
            ...context,
            state: checkResult.next.state,
          });
          if (!replayedResult.success) {
            return replayedResult;
          }
          return {
            success: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: [i, {
                ...replayedResult,
                consumed: [...previouslyConsumed, ...replayedResult.consumed],
              }],
            },
            consumed: replayedResult.consumed,
          };
        }
        return {
          success: true,
          next: {
            ...context,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: [i, result],
          },
          consumed: result.consumed,
        };
      } else if (!result.success && error.consumed < result.consumed) {
        error = result;
      }
    }
    return { ...error, success: false };
  };

  // Async parse implementation
  const parseAsync = async (
    context: ParserContext<OrState>,
  ): Promise<ParseResult> => {
    let error = getInitialError(context);
    const orderedParsers = parsers.map((p, i) =>
      [p, i] as [Parser<Mode, unknown, unknown>, number]
    );
    orderedParsers.sort(([_, a], [__, b]) =>
      context.state?.[0] === a ? -1 : context.state?.[0] === b ? 1 : a - b
    );
    for (const [parser, i] of orderedParsers) {
      const resultOrPromise = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });
      const result = await resultOrPromise;
      if (result.success && result.consumed.length > 0) {
        if (context.state?.[0] !== i && context.state?.[1].success) {
          // Different branch succeeded. Check if the new branch can also
          // consume the previously consumed input (shared options case).
          const previouslyConsumed = context.state[1].consumed;
          const checkResultOrPromise = parser.parse({
            ...context,
            buffer: previouslyConsumed,
            state: parser.initialState,
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
              error: message`${values(context.state[1].consumed)} and ${
                values(result.consumed)
              } cannot be used together.`,
            };
          }
          // Branch switch allowed - re-parse current input with state from
          // shared options to ensure dependency values are available.
          const replayedResultOrPromise = parser.parse({
            ...context,
            state: checkResult.next.state,
          });
          const replayedResult = await replayedResultOrPromise;
          if (!replayedResult.success) {
            return replayedResult;
          }
          return {
            success: true,
            next: {
              ...context,
              buffer: replayedResult.next.buffer,
              optionsTerminated: replayedResult.next.optionsTerminated,
              state: [i, {
                ...replayedResult,
                consumed: [...previouslyConsumed, ...replayedResult.consumed],
              }],
            },
            consumed: replayedResult.consumed,
          };
        }
        return {
          success: true,
          next: {
            ...context,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: [i, result],
          },
          consumed: result.consumed,
        };
      } else if (!result.success && error.consumed < result.consumed) {
        error = result;
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
    parse(context: ParserContext<OrState>) {
      return dispatchByMode(
        combinedMode,
        () => parseSync(context),
        () => parseAsync(context),
      );
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

  // or() does NOT forward normalizeValue because the active branch is
  // unknown at default time — normalizing through the wrong branch would
  // produce values that differ from what parse() returns.
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
      result: ParserResult<unknown>;
      consumed: number;
    } | null = null;
    let error = getInitialError(context);

    // Try all parsers and find the one with longest match
    for (let i = 0; i < syncParsers.length; i++) {
      const parser = syncParsers[i];
      const result = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });

      if (result.success) {
        const consumed = context.buffer.length - result.next.buffer.length;
        if (bestMatch === null || consumed > bestMatch.consumed) {
          bestMatch = { index: i, result, consumed };
        }
      } else if (error.consumed < result.consumed) {
        error = result;
      }
    }

    if (bestMatch && bestMatch.result.success) {
      return {
        success: true,
        next: {
          ...context,
          buffer: bestMatch.result.next.buffer,
          optionsTerminated: bestMatch.result.next.optionsTerminated,
          state: [bestMatch.index, bestMatch.result],
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
      result: ParserResult<unknown>;
      consumed: number;
    } | null = null;
    let error = getInitialError(context);

    // Try all parsers and find the one with longest match
    for (let i = 0; i < parsers.length; i++) {
      const parser = parsers[i];
      const resultOrPromise = parser.parse({
        ...context,
        state: context.state == null || context.state[0] !== i ||
            !context.state[1].success
          ? parser.initialState
          : context.state[1].next.state,
      });
      const result = await resultOrPromise;

      if (result.success) {
        const consumed = context.buffer.length - result.next.buffer.length;
        if (bestMatch === null || consumed > bestMatch.consumed) {
          bestMatch = { index: i, result, consumed };
        }
      } else if (error.consumed < result.consumed) {
        error = result;
      }
    }

    if (bestMatch && bestMatch.result.success) {
      return {
        success: true,
        next: {
          ...context,
          buffer: bestMatch.result.next.buffer,
          optionsTerminated: bestMatch.result.next.optionsTerminated,
          state: [bestMatch.index, bestMatch.result],
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
    parse(context: ParserContext<LongestMatchState>) {
      return dispatchByMode(
        combinedMode,
        () => parseSync(context),
        () => parseAsync(context),
      );
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

  // longestMatch() does NOT forward normalizeValue because the winning
  // branch is unknown at default time — normalizing through the wrong
  // branch would produce values that differ from what parse() returns.
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
  const nodes = buildRuntimeNodesFromPairs(
    parserPairs as readonly (readonly [
      PropertyKey,
      Parser<Mode, unknown, unknown>,
    ])[],
    (context.state && typeof context.state === "object"
      ? context.state
      : {}) as Record<PropertyKey, unknown>,
    context.exec?.path,
  );
  collectExplicitSourceValues(nodes, runtime);
  fillMissingSourceDefaults(nodes, runtime);

  // Collect dependency sources from the state tree (handles nested
  // DependencySourceState inside arrays, e.g., multiple()).
  if (context.state && typeof context.state === "object") {
    resolveStateWithRuntime(context.state, runtime);
  }

  // Pre-complete bindConfig/bindEnv source parsers (old-protocol bridge).
  completeDependencySourceDefaults(
    context,
    parserPairs,
    runtime.registry,
    context.exec,
  );

  // Expose the populated registry for child parsers' suggest() calls.
  const contextWithRegistry = {
    ...context,
    dependencyRegistry: runtime.registry,
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
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? (context.state as Record<string | symbol, unknown>)[field]
            : parser.initialState;

        yield* parser.suggest(
          { ...contextWithRegistry, state: fieldState },
          prefix,
        );
        return;
      }
    }
  }

  // Default behavior: try getting suggestions from each parser
  const suggestions: Suggestion[] = [];
  for (const [field, parser] of parserPairs) {
    const fieldState = (context.state && typeof context.state === "object" &&
        field in context.state)
      ? (context.state as Record<string | symbol, unknown>)[field]
      : parser.initialState;

    const fieldSuggestions = parser.suggest({
      ...contextWithRegistry,
      state: fieldState,
    }, prefix);

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
  const nodes = buildRuntimeNodesFromPairs(
    parserPairs as readonly (readonly [
      PropertyKey,
      Parser<Mode, unknown, unknown>,
    ])[],
    (context.state && typeof context.state === "object"
      ? context.state
      : {}) as Record<PropertyKey, unknown>,
    context.exec?.path,
  );
  collectExplicitSourceValues(nodes, runtime);
  await fillMissingSourceDefaultsAsync(nodes, runtime);

  // Collect dependency sources from state tree + pre-complete bindConfig/bindEnv.
  if (context.state && typeof context.state === "object") {
    resolveStateWithRuntime(context.state, runtime);
  }
  await completeDependencySourceDefaultsAsync(
    context,
    parserPairs,
    runtime.registry,
    context.exec,
  );

  // Expose the populated registry for child parsers' suggest() calls.
  const contextWithRegistry = {
    ...context,
    dependencyRegistry: runtime.registry,
  };

  // Check if the last token in the buffer is an option that requires a value.
  if (context.buffer.length > 0) {
    const lastToken = context.buffer[context.buffer.length - 1];

    // Find if any parser has this token as an option requiring a value
    for (const [field, parser] of parserPairs) {
      if (isOptionRequiringValue(parser.usage, lastToken)) {
        // Only get suggestions from the parser that owns this option
        const fieldState =
          (context.state && typeof context.state === "object" &&
              field in context.state)
            ? (context.state as Record<string | symbol, unknown>)[field]
            : parser.initialState;

        const suggestions = parser.suggest(
          { ...contextWithRegistry, state: fieldState },
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
    const fieldState = (context.state && typeof context.state === "object" &&
        field in context.state)
      ? (context.state as Record<string | symbol, unknown>)[field]
      : parser.initialState;

    const fieldSuggestions = parser.suggest(
      { ...contextWithRegistry, state: fieldState },
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
): Generator<
  { readonly parser: Parser<Mode, unknown, unknown>; readonly state: unknown }
> {
  for (const [field, fieldParser] of parserPairs) {
    const fieldState = context.state != null &&
        typeof context.state === "object" &&
        field in context.state
      ? (context.state as Record<string | symbol, unknown>)[field]
      : undefined;

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
  const hasDep = isWrappedDependencySource(parser) ||
    isPendingDependencySourceState(parser.initialState);
  if (
    hasDep &&
    typeof completed === "object" && completed !== null &&
    "success" in completed && completed.success &&
    "value" in completed && completed.value !== undefined
  ) {
    const depId = isWrappedDependencySource(parser)
      ? parser[wrappedDependencySourceMarker][dependencyId]
      : (parser.initialState as { [dependencyId]: symbol })[dependencyId];
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
  for (const [field, fieldParser] of fieldParserPairs) {
    const fieldState = state[field];

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
      const completed = fieldParser.complete(fieldState, exec);
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
        exec,
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
      const completed = fieldParser.complete([pendingState], exec);
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
      const completed = fieldParser.complete(annotatedFieldState, exec);
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
  for (const [field, fieldParser] of fieldParserPairs) {
    const fieldState = state[field];

    // Cases 1-3: only register actual DependencySourceState.
    // Store result for reuse in Phase 3.
    if (
      Array.isArray(fieldState) &&
      fieldState.length === 1 &&
      isPendingDependencySourceState(fieldState[0])
    ) {
      const completed = await fieldParser.complete(fieldState, exec);
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
        exec,
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
      const completed = await fieldParser.complete([pendingState], exec);
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
        exec,
      );
      preCompleted.set(field, completed);
      const depState = wrapAsDependencySourceState(completed, fieldParser);
      if (depState) registerCompletedDependency(depState, registry);
    }
  }
  return preCompleted;
}

/**
 * Recursively collects dependency values from DependencySourceState objects
 * found anywhere in the state tree.
 * @internal
 */
function collectDependencies(
  state: unknown,
  registry: DependencyRegistryLike,
  visited: WeakSet<object> = new WeakSet<object>(),
): void {
  if (state === null || state === undefined) return;

  if (typeof state === "object") {
    if (visited.has(state)) return;
    visited.add(state);
  }

  // Check if this is a DependencySourceState
  if (isDependencySourceState(state)) {
    const depId = state[dependencyId];
    const result = state.result;
    if (result.success) {
      registry.set(depId, result.value);
    }
    return;
  }

  // Recursively search in arrays
  if (Array.isArray(state)) {
    for (const item of state) {
      collectDependencies(item, registry, visited);
    }
    return;
  }

  // Recursively search in objects (but skip DeferredParseState internals)
  if (typeof state === "object" && !isDeferredParseState(state)) {
    for (const key of Reflect.ownKeys(state)) {
      collectDependencies(
        (state as Record<string | symbol, unknown>)[key],
        registry,
        visited,
      );
    }
  }
}

/**
 * Checks if a value is a plain object (created with `{}` or `Object.create(null)`).
 * Class instances like `Temporal.PlainDate`, `URL`, `Date`, etc. return false.
 * This is used to determine whether to recursively traverse an object when
 * resolving deferred parse states - we only want to traverse plain objects
 * that are part of the parser state structure, not user values.
 */
function isPlainObject(
  value: unknown,
): value is Record<string | symbol, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Collects dependency values for a DeferredParseState from the registry.
 * Returns the collected values array, or null if any required dependency
 * is missing (and no default is available).
 */
function collectDependencyValues(
  deferredState: DeferredParseState<unknown>,
  registry: DependencyRegistry,
): unknown[] | unknown | null {
  const depIds = deferredState.dependencyIds;

  // Multi-dependency case (from deriveFrom)
  if (depIds && depIds.length > 0) {
    const defaults = deferredState.defaultValues;
    const dependencyValues: unknown[] = [];

    for (let i = 0; i < depIds.length; i++) {
      const depId = depIds[i];
      if (registry.has(depId)) {
        dependencyValues.push(registry.get(depId));
      } else if (defaults && i < defaults.length) {
        dependencyValues.push(defaults[i]);
      } else {
        return null; // Missing dependency with no default
      }
    }
    return dependencyValues;
  }

  // Single dependency case (from derive)
  const depId = deferredState.dependencyId;
  if (registry.has(depId)) {
    return registry.get(depId);
  }
  // Fall back to default value if available
  const defaults = deferredState.defaultValues;
  if (defaults && defaults.length > 0) {
    return defaults[0];
  }
  return null; // Dependency not found, no default
}

/**
 * Recursively resolves DeferredParseState objects found anywhere in the state tree.
 * Returns the resolved state (sync version).
 *
 * Only traverses:
 * - DeferredParseState (to resolve it)
 * - DependencySourceState (skipped, kept as-is)
 * - Arrays (to find nested deferred states)
 * - Plain objects (to find nested deferred states in parser state structures)
 *
 * Does NOT traverse class instances (e.g., Temporal.PlainDate, URL) since these
 * are user values that should be preserved as-is.
 */
function resolveDeferred(
  state: unknown,
  registry: DependencyRegistry,
  visited: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (state === null || state === undefined) return state;

  if (typeof state === "object") {
    if (visited.has(state)) return state;
    visited.add(state);
  }

  // Check if this is a DeferredParseState - resolve it
  if (isDeferredParseState(state)) {
    const deferredState = state as DeferredParseState<unknown>;
    const dependencyValue = collectDependencyValues(deferredState, registry);

    if (dependencyValue === null) {
      return deferredState.preliminaryResult;
    }

    const reParseResult = deferredState.parser[parseWithDependency](
      deferredState.rawInput,
      dependencyValue,
    );

    // Handle sync vs async result
    if (reParseResult instanceof Promise) {
      // For async, use preliminary result (will be handled by async version)
      return deferredState.preliminaryResult;
    }
    return reParseResult;
  }

  // Skip DependencySourceState - it's a marker, not something to resolve
  if (isDependencySourceState(state)) {
    return state;
  }

  // Recursively resolve in arrays
  if (Array.isArray(state)) {
    return state.map((item) => resolveDeferred(item, registry, visited));
  }

  // Only traverse plain objects (parser state structures)
  // Skip class instances (user values like Temporal.PlainDate, URL, etc.)
  if (isPlainObject(state)) {
    const resolved: Record<string | symbol, unknown> = {};
    for (const key of Reflect.ownKeys(state)) {
      resolved[key] = resolveDeferred(state[key], registry, visited);
    }
    return resolved;
  }

  // Everything else (primitives, class instances) - return as-is
  return state;
}

function resolveDeferredParseStates<
  T extends Record<string | symbol, unknown> | unknown[],
>(
  fieldStates: T,
  initialRegistry?: DependencyRegistry,
): T {
  // First pass: Build dependency registry from all DependencySourceState fields
  // (recursively searching through nested structures)
  const registry = initialRegistry ?? new DependencyRegistry();
  collectDependencies(fieldStates, registry);

  // Second pass: Resolve all DeferredParseState fields recursively
  return resolveDeferred(fieldStates, registry) as T;
}

/**
 * Recursively resolves DeferredParseState objects found anywhere in the state tree.
 * Returns the resolved state (async version).
 *
 * Only traverses:
 * - DeferredParseState (to resolve it)
 * - DependencySourceState (skipped, kept as-is)
 * - Arrays (to find nested deferred states)
 * - Plain objects (to find nested deferred states in parser state structures)
 *
 * Does NOT traverse class instances (e.g., Temporal.PlainDate, URL) since these
 * are user values that should be preserved as-is.
 */
async function resolveDeferredAsync(
  state: unknown,
  registry: DependencyRegistry,
  visited: WeakSet<object> = new WeakSet<object>(),
): Promise<unknown> {
  if (state === null || state === undefined) return state;

  if (typeof state === "object") {
    if (visited.has(state)) return state;
    visited.add(state);
  }

  // Check if this is a DeferredParseState - resolve it
  if (isDeferredParseState(state)) {
    const deferredState = state as DeferredParseState<unknown>;
    const dependencyValue = collectDependencyValues(deferredState, registry);

    if (dependencyValue === null) {
      return deferredState.preliminaryResult;
    }

    const reParseResult = deferredState.parser[parseWithDependency](
      deferredState.rawInput,
      dependencyValue,
    );

    // Handle both sync and async results
    return Promise.resolve(reParseResult);
  }

  // Skip DependencySourceState - it's a marker, not something to resolve
  if (isDependencySourceState(state)) {
    return state;
  }

  // Recursively resolve in arrays
  if (Array.isArray(state)) {
    return Promise.all(
      state.map((item) => resolveDeferredAsync(item, registry, visited)),
    );
  }

  // Only traverse plain objects (parser state structures)
  // Skip class instances (user values like Temporal.PlainDate, URL, etc.)
  if (isPlainObject(state)) {
    const resolved: Record<string | symbol, unknown> = {};
    const keys = Reflect.ownKeys(state);
    await Promise.all(
      keys.map(async (key) => {
        resolved[key] = await resolveDeferredAsync(
          state[key],
          registry,
          visited,
        );
      }),
    );
    return resolved;
  }

  return state;
}

/**
 * Async version of resolveDeferredParseStates for async parsers.
 * @internal
 */
async function resolveDeferredParseStatesAsync<
  T extends Record<string | symbol, unknown> | unknown[],
>(
  fieldStates: T,
  initialRegistry?: DependencyRegistry,
): Promise<T> {
  // First pass: Build dependency registry from all DependencySourceState fields
  // (recursively searching through nested structures)
  const registry = initialRegistry ?? new DependencyRegistry();
  collectDependencies(fieldStates, registry);

  // Second pass: Resolve all DeferredParseState fields recursively
  return await resolveDeferredAsync(fieldStates, registry) as T;
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
    Map<string | symbol, unknown>
  >();
  const createFieldStateGetter = (parentState: unknown) => {
    return (
      field: keyof T,
      parser: Parser<Mode, unknown, unknown>,
    ): unknown => {
      const fieldKey = field as string | symbol;
      const cache = parentState != null && typeof parentState === "object"
        ? (inheritedFieldStateCache.get(parentState) ??
          (() => {
            const stateCache = new Map<string | symbol, unknown>();
            inheritedFieldStateCache.set(parentState, stateCache);
            return stateCache;
          })())
        : undefined;
      if (cache?.has(fieldKey)) {
        return cache.get(fieldKey);
      }
      const sourceState = parentState != null &&
          typeof parentState === "object" &&
          fieldKey in parentState
        ? (parentState as Record<string | symbol, unknown>)[fieldKey]
        : parser.initialState;
      if (sourceState == null || typeof sourceState !== "object") {
        cache?.set(fieldKey, sourceState);
        return sourceState;
      }
      const annotations = getAnnotations(parentState);
      if (
        annotations === undefined || getAnnotations(sourceState) === annotations
      ) {
        cache?.set(fieldKey, sourceState);
        return sourceState;
      }
      const inheritedState =
        Reflect.get(parser, inheritParentAnnotationsKey) === true
          ? injectAnnotations(sourceState, annotations)
          : inheritAnnotations(parentState, sourceState);
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

    // Keep trying to parse fields until no more can be matched
    let madeProgress = true;
    while (madeProgress && currentContext.buffer.length > 0) {
      madeProgress = false;
      const getFieldState = createFieldStateGetter(currentContext.state);

      for (const [field, parser] of parserPairs) {
        const result = (parser as Parser<"sync", unknown, unknown>).parse({
          ...currentContext,
          state: getFieldState(field, parser),
        });

        if (result.success && result.consumed.length > 0) {
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: result.next.state,
            } as { readonly [K in keyof T]: unknown },
          };
          allConsumed.push(...result.consumed);
          anySuccess = true;
          madeProgress = true;
          break; // Restart the field loop with updated context
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
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

    // If buffer is empty and no parser consumed input, check if all parsers can complete
    if (context.buffer.length === 0) {
      let allCanComplete = true;
      const getFieldState = createFieldStateGetter(context.state);
      for (const [field, parser] of parserPairs) {
        const fieldState = getFieldState(field, parser);
        const completeResult = (parser as Parser<"sync", unknown, unknown>)
          .complete(fieldState, context.exec);
        if (!completeResult.success) {
          allCanComplete = false;
          break;
        }
      }

      if (allCanComplete) {
        return {
          success: true,
          next: context,
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

    // Keep trying to parse fields until no more can be matched
    let madeProgress = true;
    while (madeProgress && currentContext.buffer.length > 0) {
      madeProgress = false;
      const getFieldState = createFieldStateGetter(currentContext.state);

      for (const [field, parser] of parserPairs) {
        const resultOrPromise = parser.parse({
          ...currentContext,
          state: getFieldState(field, parser),
        });
        const result = await resultOrPromise;

        if (result.success && result.consumed.length > 0) {
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: {
              ...(currentContext.state as Record<string | symbol, unknown>),
              [field as string | symbol]: result.next.state,
            } as { readonly [K in keyof T]: unknown },
          };
          allConsumed.push(...result.consumed);
          anySuccess = true;
          madeProgress = true;
          break; // Restart the field loop with updated context
        } else if (!result.success && error.consumed < result.consumed) {
          error = result;
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

    // If buffer is empty and no parser consumed input, check if all parsers can complete
    if (context.buffer.length === 0) {
      let allCanComplete = true;
      const getFieldState = createFieldStateGetter(context.state);
      for (const [field, parser] of parserPairs) {
        const fieldState = getFieldState(field, parser);
        const completeResult = await parser.complete(fieldState, context.exec);
        if (!completeResult.success) {
          allCanComplete = false;
          break;
        }
      }

      if (allCanComplete) {
        return {
          success: true,
          next: context,
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
    complete(
      state: { readonly [K in keyof T]: unknown },
      exec?: ExecutionContext,
    ) {
      return dispatchByMode(
        combinedMode,
        () => {
          // Phase 1: Build dependency runtime and collect/fill source values
          // via parser dependency metadata instead of state-type inspection.
          // Reuse the parent's runtime if present so that nested objects
          // share dependency state across the entire parse tree.
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const nodes = buildRuntimeNodesFromPairs(
            parserPairs as readonly (readonly [
              PropertyKey,
              Parser<Mode, unknown, unknown>,
            ])[],
            state as Record<PropertyKey, unknown>,
            exec?.path,
          );
          collectExplicitSourceValues(nodes, runtime);
          fillMissingSourceDefaults(nodes, runtime);

          // Phase 1b: Pre-complete ALL dependency source parsers via
          // old-protocol bridge (handles all 4 cases: pending state in
          // arrays, undefined with pending initialState, wrapped markers,
          // and non-null state from bindConfig/bindEnv).  This is needed
          // because not all wrappers compose dependencyMetadata yet.
          const preCompleted = preCompleteAndRegisterDependencies(
            state as Record<string | symbol, unknown>,
            parserPairs as readonly (readonly [
              string | symbol,
              Parser<Mode, unknown, unknown>,
            ])[],
            runtime.registry,
            childExec,
          );

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
                fieldParser.complete(fieldState, childExec),
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
          // Phase 1: Build dependency runtime and collect/fill source values.
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const nodes = buildRuntimeNodesFromPairs(
            parserPairs as readonly (readonly [
              PropertyKey,
              Parser<Mode, unknown, unknown>,
            ])[],
            state as Record<PropertyKey, unknown>,
            exec?.path,
          );
          collectExplicitSourceValues(nodes, runtime);
          await fillMissingSourceDefaultsAsync(nodes, runtime);

          // Phase 1b: Pre-complete ALL dependency source parsers via
          // old-protocol bridge (all 4 cases).
          const preCompleted = await preCompleteAndRegisterDependenciesAsync(
            state as Record<string | symbol, unknown>,
            parserPairs as readonly (readonly [
              string | symbol,
              Parser<Mode, unknown, unknown>,
            ])[],
            runtime.registry,
            childExec,
          );

          // Phase 2: Build the full annotated state, then resolve the
          // ENTIRE object at once for order-independent resolution.
          const getFieldState = createFieldStateGetter(state);
          const annotatedState: Record<string | symbol, unknown> = {};
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];
            annotatedState[fieldKey] = getFieldState(field, fieldParser);
          }
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
          for (const field of parserKeys) {
            const fieldKey = field as string | symbol;
            const fieldParser = parsers[field];

            let valueResult: import("./valueparser.ts").ValueParserResult<
              unknown
            >;
            const preCompletedResult = preCompleted.get(fieldKey);
            if (preCompletedResult !== undefined) {
              valueResult = unwrapCompleteResult(preCompletedResult);
            } else {
              const fieldState = resolvedFieldStates[fieldKey];
              valueResult = unwrapCompleteResult(
                await fieldParser.complete(fieldState, childExec),
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
  const stateArray = context.state as unknown[] | undefined;

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[i]
      : parser.initialState;

    const parserSuggestions = parser.suggest({
      ...context,
      state: parserState,
    }, prefix);

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
  const stateArray = context.state as unknown[] | undefined;

  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    const parserState = stateArray && Array.isArray(stateArray)
      ? stateArray[i]
      : parser.initialState;

    const parserSuggestions = parser.suggest({
      ...context,
      state: parserState,
    }, prefix);

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
        const result = parser.parse({
          ...currentContext,
          state: stateArray[index],
        });

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s: unknown, idx: number) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as TupleState,
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
          const result = parser.parse({
            ...currentContext,
            state: stateArray[index],
          });

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s: unknown, idx: number) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as TupleState,
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
        const resultOrPromise = parser.parse({
          ...currentContext,
          state: stateArray[index],
        });
        const result = await resultOrPromise;

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s: unknown, idx: number) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as TupleState,
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
          const resultOrPromise = parser.parse({
            ...currentContext,
            state: stateArray[index],
          });
          const result = await resultOrPromise;

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s: unknown, idx: number) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as TupleState,
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
          const nodes = buildRuntimeNodesFromPairs(
            syncParsers.map((p, i) => [i, p] as const),
            Object.fromEntries(stateArray.map((s, i) => [i, s])),
            exec?.path,
          );
          collectExplicitSourceValues(nodes, runtime);
          fillMissingSourceDefaults(nodes, runtime);

          // Phase 1b: Pre-complete dependency sources (all 4 cases).
          // Use string keys for the state record since
          // Object.fromEntries converts numeric indices to strings.
          const tuplePairs = syncParsers.map(
            (p, i) =>
              [String(i), p] as [string, Parser<"sync", unknown, unknown>],
          );
          const tupleState = Object.fromEntries(
            stateArray.map((s, i) => [String(i), s]),
          );
          const preCompleted = preCompleteAndRegisterDependencies(
            tupleState,
            tuplePairs,
            runtime.registry,
            childExec,
          );

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
                elementParser.complete(elementState, childExec),
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

          // Phase 1: Build dependency runtime and collect/fill source values.
          const runtime = exec?.dependencyRuntime ??
            createDependencyRuntimeContext(exec?.dependencyRegistry);
          const childExec: ExecutionContext = {
            ...exec,
            dependencyRuntime: runtime,
          } as ExecutionContext;
          const nodes = buildRuntimeNodesFromPairs(
            parsers.map((p, i) => [i, p] as const),
            Object.fromEntries(stateArray.map((s, i) => [i, s])),
            exec?.path,
          );
          collectExplicitSourceValues(nodes, runtime);
          await fillMissingSourceDefaultsAsync(nodes, runtime);

          // Phase 1b: Pre-complete dependency sources (all 4 cases).
          const tuplePairs = parsers.map(
            (p, i) =>
              [String(i), p] as [
                string,
                Parser<Mode, unknown, unknown>,
              ],
          );
          const tupleState = Object.fromEntries(
            stateArray.map((s, i) => [String(i), s]),
          );
          const preCompleted = await preCompleteAndRegisterDependenciesAsync(
            tupleState,
            tuplePairs,
            runtime.registry,
            childExec,
          );

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
                await elementParser.complete(elementState, childExec),
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

  const initialState: Record<string | symbol, unknown> = {};
  for (let i = 0; i < parsers.length; i++) {
    const parser = parsers[i];
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like withDefault(), or()),
      // include a __parser_N sentinel so that an outer merge's
      // extractParserState will forward these keys when extracting state
      // for this (inner) merge.
      initialState[`__parser_${i}`] = undefined;
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
      const key = `__parser_${index}`;
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
    result: ParserResult<unknown>,
    index: number,
  ): MergeState => {
    if (parser.initialState === undefined) {
      // For parsers with undefined initialState (like withDefault()),
      // store their state separately to avoid conflicts with object merging.
      const key = `__parser_${index}`;
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
    // For regular object parsers, use the original merging approach
    return result.success
      ? { ...context.state, ...result.next.state as MergeState }
      : { ...context.state };
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

      const result = parser.parse({
        ...currentContext,
        state: parserState as Parameters<typeof parser.parse>[0]["state"],
      });

      if (result.success) {
        const newState = mergeResultState(parser, currentContext, result, i);
        const newContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newState,
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

      const resultOrPromise = parser.parse({
        ...currentContext,
        state: parserState as Parameters<typeof parser.parse>[0]["state"],
      });
      const result = await resultOrPromise;

      if (result.success) {
        const newState = mergeResultState(parser, currentContext, result, i);
        const newContext = {
          ...currentContext,
          buffer: result.next.buffer,
          optionsTerminated: result.next.optionsTerminated,
          state: newState,
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

  // Collect field parser pairs from all children so that nested merge()
  // can pre-complete dependency source fields at the outer level.
  const mergedFieldParsers = collectChildFieldParsers(parsers);

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
          const key = `__parser_${index}`;
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
        const childFieldPairs = collectChildFieldParsers(syncParsers);
        preCompleteAndRegisterDependencies(
          state as Record<string | symbol, unknown>,
          childFieldPairs,
          runtime.registry,
          childExec,
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
          const result = unwrapCompleteResult(
            parser.complete(
              parserState as Parameters<typeof parser.complete>[0],
              childExec,
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
        const childFieldPairs = collectChildFieldParsers(parsers);
        await preCompleteAndRegisterDependenciesAsync(
          state as Record<string | symbol, unknown>,
          childFieldPairs,
          runtime.registry,
          childExec,
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
          const result = unwrapCompleteResult(
            await parser.complete(
              parserState as Parameters<typeof parser.complete>[0],
              childExec,
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
          const key = `__parser_${i}`;
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
          const childFieldPairs = collectChildFieldParsers(parsers);
          if (context.state && typeof context.state === "object") {
            resolveStateWithRuntime(context.state, runtime);
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

            const parserSuggestions = parser.suggest({
              ...contextWithRegistry,
              state: parserState as Parameters<
                typeof parser.suggest
              >[0]["state"],
            }, prefix);

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
      const childFieldPairs = collectChildFieldParsers(syncParsers);
      if (context.state && typeof context.state === "object") {
        resolveStateWithRuntime(context.state, runtime);
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

          const parserSuggestions = parser.suggest({
            ...contextWithRegistry,
            state: parserState as Parameters<typeof parser.suggest>[0]["state"],
          }, prefix);

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
): {
  context: ParserContext<readonly unknown[]>;
  stateArray: unknown[] | undefined;
} {
  const stateArray = preParsedContext.state as unknown[] | undefined;
  const runtime = createDependencyRuntimeContext(
    preParsedContext.dependencyRegistry?.clone(),
  );
  if (stateArray && Array.isArray(stateArray)) {
    resolveStateWithRuntime(stateArray, runtime);
  }
  return {
    context: { ...preParsedContext, dependencyRegistry: runtime.registry },
    stateArray,
  };
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
    context.state.slice(),
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
  return await preParseSuggestLoop(context, context.state.slice(), parsers);
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
    const resultOrPromise = parser.parse({
      ...context,
      state: parserState,
    });

    // If the result is a thenable, chain the rest asynchronously.
    if (
      resultOrPromise != null && typeof resultOrPromise === "object" &&
      "then" in resultOrPromise && typeof resultOrPromise.then === "function"
    ) {
      const tail = remaining.slice(ri + 1);
      return (resultOrPromise as Promise<ParserResult<readonly unknown[]>>)
        .then((result) => {
          if (result.success && result.consumed.length > 0) {
            stateArray[index] = result.next.state;
            matchedParsers.add(index);
            return preParseSuggestLoop(
              {
                ...context,
                buffer: result.next.buffer,
                optionsTerminated: result.next.optionsTerminated,
                state: stateArray,
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
      stateArray[index] = result.next.state;
      matchedParsers.add(index);
      return {
        ...context,
        buffer: result.next.buffer,
        optionsTerminated: result.next.optionsTerminated,
        state: stateArray,
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
        const result = parser.parse({
          ...currentContext,
          state: stateArray[index],
        });

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s, idx) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as readonly unknown[],
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
          const result = parser.parse({
            ...currentContext,
            state: stateArray[index],
          });

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s, idx) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as readonly unknown[],
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
        const result = await parser.parse({
          ...currentContext,
          state: stateArray[index],
        });

        if (result.success && result.consumed.length > 0) {
          // Parser succeeded and consumed input - take this match
          const newStateArray = stateArray.map((s, idx) =>
            idx === index ? result.next.state : s
          );
          currentContext = {
            ...currentContext,
            buffer: result.next.buffer,
            optionsTerminated: result.next.optionsTerminated,
            state: newStateArray as readonly unknown[],
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
          const result = await parser.parse({
            ...currentContext,
            state: stateArray[index],
          });

          if (result.success && result.consumed.length < 1) {
            // Parser succeeded without consuming input (like optional)
            const newStateArray = stateArray.map((s, idx) =>
              idx === index ? result.next.state : s
            );
            currentContext = {
              ...currentContext,
              state: newStateArray as readonly unknown[],
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

    // Phase 1: Build dependency runtime and collect/fill source values.
    const runtime = exec?.dependencyRuntime ??
      createDependencyRuntimeContext(exec?.dependencyRegistry);
    const childExec: ExecutionContext = {
      ...exec,
      dependencyRuntime: runtime,
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
      const parserState = prepareStateForCompletion(
        resolvedArray[i],
        parser,
      );
      const result = unwrapCompleteResult(
        parser.complete(parserState, childExec),
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

    // Phase 1: Build dependency runtime and collect/fill source values.
    const runtime = exec?.dependencyRuntime ??
      createDependencyRuntimeContext(exec?.dependencyRegistry);
    const childExec: ExecutionContext = {
      ...exec,
      dependencyRuntime: runtime,
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
      const parserState = prepareStateForCompletion(
        resolvedArray[i],
        parser,
      );
      const result = unwrapCompleteResult(
        await parser.complete(parserState, childExec),
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

  return {
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
            buildSuggestRegistry(preParsedContext);

          const suggestions: Suggestion[] = [];

          for (let i = 0; i < parsers.length; i++) {
            const parser = parsers[i];
            const parserState = stateArray && Array.isArray(stateArray)
              ? stateArray[i]
              : parser.initialState;

            const parserSuggestions = parser.suggest({
              ...contextWithRegistry,
              state: parserState,
            }, prefix);

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
      );

      return (function* () {
        const suggestions: Suggestion[] = [];

        for (let i = 0; i < syncParsers.length; i++) {
          const parser = syncParsers[i];
          const parserState = stateArray && Array.isArray(stateArray)
            ? stateArray[i]
            : parser.initialState;

          const parserSuggestions = parser.suggest({
            ...contextWithRegistry,
            state: parserState,
          }, prefix);

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
  };
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
  branchError?: (
    discriminatorValue: string | undefined,
    error: Message,
  ) => Message;

  /**
   * Custom error message for no matching input.
   */
  noMatch?: Message | ((context: NoMatchContext) => Message);
}

/**
 * Options for customizing the {@link conditional} combinator behavior.
 * @since 0.8.0
 */
export interface ConditionalOptions {
  /**
   * Custom error messages.
   */
  errors?: ConditionalErrorOptions;
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

      const branchResult = branchParser.parse({
        ...context,
        state: state.branchState,
        usage: branchParser.usage,
      });

      if (branchResult.success) {
        return {
          success: true,
          next: {
            ...branchResult.next,
            state: {
              ...state,
              branchState: branchResult.next.state,
            },
          },
          consumed: branchResult.consumed,
        };
      }
      return branchResult;
    }

    // Try to parse discriminator first
    const discriminatorResult = syncDiscriminator.parse({
      ...context,
      state: state.discriminatorState,
    });

    if (
      discriminatorResult.success && discriminatorResult.consumed.length > 0
    ) {
      // Complete discriminator to get the value
      const completionResult = syncDiscriminator.complete(
        discriminatorResult.next.state,
        context.exec,
      );

      if (completionResult.success) {
        const value = completionResult.value;
        const branchParser = syncBranches[value];

        if (branchParser) {
          // Try to parse more from the branch
          const branchParseResult = branchParser.parse({
            ...context,
            buffer: discriminatorResult.next.buffer,
            optionsTerminated: discriminatorResult.next.optionsTerminated,
            state: branchParser.initialState,
            usage: branchParser.usage,
          });

          if (branchParseResult.success) {
            return {
              success: true,
              next: {
                ...branchParseResult.next,
                state: {
                  discriminatorState: discriminatorResult.next.state,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: branchParseResult.next.state,
                },
              },
              consumed: [
                ...discriminatorResult.consumed,
                ...branchParseResult.consumed,
              ],
            };
          }

          // Branch parse failed but discriminator succeeded
          return {
            success: true,
            next: {
              ...discriminatorResult.next,
              state: {
                discriminatorState: discriminatorResult.next.state,
                discriminatorValue: value,
                selectedBranch: { kind: "branch", key: value },
                branchState: branchParser.initialState,
              },
            },
            consumed: discriminatorResult.consumed,
          };
        }
      }
    }

    // Discriminator didn't match, try default branch
    if (syncDefaultBranch !== undefined) {
      const defaultResult = syncDefaultBranch.parse({
        ...context,
        state: state.branchState ?? syncDefaultBranch.initialState,
        usage: syncDefaultBranch.usage,
      });

      if (defaultResult.success && defaultResult.consumed.length > 0) {
        return {
          success: true,
          next: {
            ...defaultResult.next,
            state: {
              ...state,
              selectedBranch: { kind: "default" },
              branchState: defaultResult.next.state,
            },
          },
          consumed: defaultResult.consumed,
        };
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

      const branchResult = await branchParser.parse({
        ...context,
        state: state.branchState,
        usage: branchParser.usage,
      });

      if (branchResult.success) {
        return {
          success: true,
          next: {
            ...branchResult.next,
            state: {
              ...state,
              branchState: branchResult.next.state,
            },
          },
          consumed: branchResult.consumed,
        };
      }
      return branchResult;
    }

    // Try to parse discriminator first
    const discriminatorResult = await discriminator.parse({
      ...context,
      state: state.discriminatorState,
    });

    if (
      discriminatorResult.success && discriminatorResult.consumed.length > 0
    ) {
      // Complete discriminator to get the value
      const completionResult = await discriminator.complete(
        discriminatorResult.next.state,
        context.exec,
      );

      if (completionResult.success) {
        const value = completionResult.value;
        const branchParser = branches[value];

        if (branchParser) {
          // Try to parse more from the branch
          const branchParseResult = await branchParser.parse({
            ...context,
            buffer: discriminatorResult.next.buffer,
            optionsTerminated: discriminatorResult.next.optionsTerminated,
            state: branchParser.initialState,
            usage: branchParser.usage,
          });

          if (branchParseResult.success) {
            return {
              success: true,
              next: {
                ...branchParseResult.next,
                state: {
                  discriminatorState: discriminatorResult.next.state,
                  discriminatorValue: value,
                  selectedBranch: { kind: "branch", key: value },
                  branchState: branchParseResult.next.state,
                },
              },
              consumed: [
                ...discriminatorResult.consumed,
                ...branchParseResult.consumed,
              ],
            };
          }

          // Branch parse failed but discriminator succeeded
          return {
            success: true,
            next: {
              ...discriminatorResult.next,
              state: {
                discriminatorState: discriminatorResult.next.state,
                discriminatorValue: value,
                selectedBranch: { kind: "branch", key: value },
                branchState: branchParser.initialState,
              },
            },
            consumed: discriminatorResult.consumed,
          };
        }
      }
    }

    // Discriminator didn't match, try default branch
    if (defaultBranch !== undefined) {
      const defaultResult = await defaultBranch.parse({
        ...context,
        state: state.branchState ?? defaultBranch.initialState,
        usage: defaultBranch.usage,
      });

      if (defaultResult.success && defaultResult.consumed.length > 0) {
        return {
          success: true,
          next: {
            ...defaultResult.next,
            state: {
              ...state,
              selectedBranch: { kind: "default" },
              branchState: defaultResult.next.state,
            },
          },
          consumed: defaultResult.consumed,
        };
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

    // No branch selected yet
    if (state.selectedBranch === undefined) {
      // If we have default branch, use it
      if (syncDefaultBranch !== undefined) {
        const branchState = state.branchState ?? syncDefaultBranch.initialState;
        const defaultResult = syncDefaultBranch.complete(branchState, exec);
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

      // No default branch, discriminator is required
      return {
        success: false,
        error: message`Missing required discriminator option.`,
      };
    }

    // Complete selected branch
    const branchParser = state.selectedBranch.kind === "default"
      ? syncDefaultBranch!
      : syncBranches[state.selectedBranch.key];

    // First, complete the discriminator to get DependencySourceState if applicable
    const discriminatorCompleteResult = syncDiscriminator.complete(
      state.discriminatorState,
      exec,
    );
    // discriminatorCompleteResult may be { success: true, value: ... } or DependencySourceState

    // To propagate dependency from discriminator to branch:
    // 1. Wrap discriminator state and branch state together
    // 2. Resolve deferred parse states with dependency registry populated from discriminator
    const combinedState = {
      _discriminator: state.discriminatorState,
      _branch: state.branchState,
    };
    const resolvedCombinedState = resolveDeferredParseStates(combinedState);
    const resolvedBranchState = resolvedCombinedState._branch;

    const branchResult = branchParser.complete(resolvedBranchState, exec);

    if (!branchResult.success) {
      // Add context to error message
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

    // Get the discriminator value: either from DependencySourceState or regular completion
    let discriminatorValue: string | undefined;
    if (state.selectedBranch.kind === "default") {
      discriminatorValue = undefined;
    } else if (isDependencySourceState(discriminatorCompleteResult)) {
      discriminatorValue = discriminatorCompleteResult.result.success
        ? discriminatorCompleteResult.result.value as string
        : state.selectedBranch.key;
    } else if (discriminatorCompleteResult.success) {
      discriminatorValue = discriminatorCompleteResult.value;
    } else {
      discriminatorValue = state.selectedBranch.key;
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
    // No branch selected yet
    if (state.selectedBranch === undefined) {
      // If we have default branch, use it
      if (defaultBranch !== undefined) {
        const branchState = state.branchState ?? defaultBranch.initialState;
        const defaultResult = await defaultBranch.complete(branchState, exec);
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

      // No default branch, discriminator is required
      return {
        success: false,
        error: message`Missing required discriminator option.`,
      };
    }

    // Complete selected branch
    const branchParser = state.selectedBranch.kind === "default"
      ? defaultBranch!
      : branches[state.selectedBranch.key];

    // First, complete the discriminator to get DependencySourceState if applicable
    const discriminatorCompleteResult = await discriminator.complete(
      state.discriminatorState,
      exec,
    );

    // To propagate dependency from discriminator to branch:
    // 1. Wrap discriminator state and branch state together
    // 2. Resolve deferred parse states with dependency registry populated from discriminator
    const combinedState = {
      _discriminator: state.discriminatorState,
      _branch: state.branchState,
    };
    const resolvedCombinedState = await resolveDeferredParseStatesAsync(
      combinedState,
    );
    const resolvedBranchState = resolvedCombinedState._branch;

    const branchResult = await branchParser.complete(
      resolvedBranchState,
      exec,
    );

    if (!branchResult.success) {
      // Add context to error message
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

    // Get the discriminator value: either from DependencySourceState or regular completion
    let discriminatorValue: string | undefined;
    if (state.selectedBranch.kind === "default") {
      discriminatorValue = undefined;
    } else if (isDependencySourceState(discriminatorCompleteResult)) {
      discriminatorValue = discriminatorCompleteResult.result.success
        ? discriminatorCompleteResult.result.value as string
        : state.selectedBranch.key;
    } else if (discriminatorCompleteResult.success) {
      discriminatorValue = discriminatorCompleteResult.value;
    } else {
      discriminatorValue = state.selectedBranch.key;
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
      // Discriminator suggestions
      yield* syncDiscriminator.suggest(
        { ...context, state: state.discriminatorState },
        prefix,
      );

      // Default branch suggestions if available
      if (syncDefaultBranch !== undefined) {
        yield* syncDefaultBranch.suggest(
          {
            ...context,
            state: state.branchState ?? syncDefaultBranch.initialState,
          },
          prefix,
        );
      }
    } else {
      // Delegate to selected branch
      const branchParser = state.selectedBranch.kind === "default"
        ? syncDefaultBranch!
        : syncBranches[state.selectedBranch.key];

      yield* branchParser.suggest(
        { ...context, state: state.branchState },
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
      // Discriminator suggestions
      yield* discriminator.suggest(
        { ...context, state: state.discriminatorState },
        prefix,
      );

      // Default branch suggestions if available
      if (defaultBranch !== undefined) {
        yield* defaultBranch.suggest(
          {
            ...context,
            state: state.branchState ?? defaultBranch.initialState,
          },
          prefix,
        );
      }
    } else {
      // Delegate to selected branch
      const branchParser = state.selectedBranch.kind === "default"
        ? defaultBranch!
        : branches[state.selectedBranch.key];

      yield* branchParser.suggest(
        { ...context, state: state.branchState },
        prefix,
      );
    }
  }

  return {
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
  };
}
