import {
  getWrappedChildParseState,
  getWrappedChildState,
  isAnnotationWrappedInitialState,
  normalizeInjectedAnnotationState,
} from "./annotation-state.ts";
import {
  type DerivedValueParser,
  getDefaultValuesFunction,
  getDependencyIds,
  getSnapshottedDefaultDependencyValues,
  isDerivedValueParser,
  suggestWithDependency,
} from "./internal/dependency.ts";
import { annotateFreshArray, getAnnotations } from "./internal/annotations.ts";
import { extractDependencyMetadata } from "./dependency-metadata.ts";
import {
  replayDerivedParser,
  replayDerivedParserAsync,
} from "./dependency-runtime.ts";
import {
  mergeChildExec,
  withChildContext,
  withChildExecPath,
} from "./execution-context.ts";
import type { DocFragment } from "./doc.ts";
import {
  dispatchByMode,
  dispatchIterableByMode,
  wrapForMode,
} from "./internal/mode-dispatch.ts";
import {
  completeOrExtractPhase2Seed,
  extractPhase2SeedKey,
} from "./phase2-seed.ts";
import type { TraceEntry } from "./input-trace.ts";
import type { DependencyRegistryLike } from "./registry-types.ts";
import { validateCommandNames, validateOptionNames } from "./validate.ts";

/**
 * A shared empty set used as the `leadingNames` value for parsers that
 * do not match any specific name at the first buffer position.
 */
const EMPTY_LEADING_NAMES: ReadonlySet<string> = new Set();

/** @internal */
export type OptionState<T> = ValueParserResult<T> | undefined;

function hasParsedOptionValue<M extends Mode, T>(
  state: ValueParserResult<T | boolean> | undefined,
  valueParser: ValueParser<M, T> | undefined,
): boolean {
  if (valueParser != null) {
    return state != null &&
      typeof state === "object" &&
      "success" in state &&
      typeof state.success === "boolean";
  }
  return state != null &&
    "success" in state &&
    state.success &&
    (state as { value?: boolean }).value === true;
}

/**
 * Helper function to create the stored state for an option or argument value.
 *
 * Primitive parsers now keep only the plain parse result as their local state.
 * Any dependency-aware replay information is recorded separately in the
 * execution trace.
 * @internal
 */
function createOptionParseState<M extends Mode, T>(
  parseResult: ValueParserResult<T>,
): ValueParserResult<T> {
  return parseResult;
}

function buildTraceEntry<M extends Mode, T>(
  kind: TraceEntry["kind"],
  rawInput: string,
  consumed: readonly string[],
  valueParser: ValueParser<M, T>,
  parseResult: ValueParserResult<T>,
  optionNames?: readonly string[],
): TraceEntry {
  const entry: TraceEntry = {
    kind,
    rawInput,
    consumed,
    preliminaryResult: parseResult,
    ...(optionNames != null ? { optionNames } : {}),
    metavar: valueParser.metavar,
  };
  if (isDerivedValueParser(valueParser)) {
    const defaults = getSnapshottedDefaultDependencyValues(
      parseResult as ValueParserResult<T>,
    );
    if (defaults != null) {
      return { ...entry, defaultDependencyValues: defaults };
    }
  }
  return entry;
}

function recordTrace<TState>(
  context: ParserContext<TState>,
  entry: TraceEntry,
): ParserContext<TState> {
  if (context.exec?.trace == null) return context;
  const trace = context.exec.trace.set(context.exec.path, entry);
  return {
    ...context,
    trace,
    exec: {
      ...context.exec,
      trace,
    },
  };
}

function resolveDerivedCompletionSync<T>(
  derivedMetadata: ReturnType<typeof extractDependencyMetadata> | undefined,
  state: ValueParserResult<T>,
  exec?: ExecutionContext,
): ValueParserResult<T> {
  if (derivedMetadata?.derived == null || exec?.dependencyRuntime == null) {
    return state;
  }
  const traceEntry = exec.trace?.get(exec.path);
  if (traceEntry?.rawInput == null) {
    return traceEntry?.preliminaryResult as ValueParserResult<T> ?? state;
  }
  if (traceEntry.preliminaryResult != null) {
    const resolution = exec.dependencyRuntime.resolveDependencies({
      dependencyIds: derivedMetadata.derived.dependencyIds,
      defaultValues: traceEntry.defaultDependencyValues,
    });
    if (
      resolution.kind === "resolved" &&
      resolution.usedDefaults.length > 0 &&
      resolution.usedDefaults.every((used) => used)
    ) {
      return traceEntry.preliminaryResult as ValueParserResult<T>;
    }
  }
  const replayed = replayDerivedParser(
    {
      path: exec.path,
      parser: { dependencyMetadata: { derived: derivedMetadata.derived } },
      state,
      defaultDependencyValues: traceEntry.defaultDependencyValues,
    },
    traceEntry.rawInput,
    exec.dependencyRuntime,
  );
  return replayed as ValueParserResult<T> ??
    traceEntry.preliminaryResult as ValueParserResult<T> ??
    state;
}

async function resolveDerivedCompletionAsync<T>(
  derivedMetadata: ReturnType<typeof extractDependencyMetadata> | undefined,
  state: ValueParserResult<T>,
  exec?: ExecutionContext,
): Promise<ValueParserResult<T>> {
  if (derivedMetadata?.derived == null || exec?.dependencyRuntime == null) {
    return state;
  }
  const traceEntry = exec.trace?.get(exec.path);
  if (traceEntry?.rawInput == null) {
    return traceEntry?.preliminaryResult as ValueParserResult<T> ?? state;
  }
  if (traceEntry.preliminaryResult != null) {
    const resolution = exec.dependencyRuntime.resolveDependencies({
      dependencyIds: derivedMetadata.derived.dependencyIds,
      defaultValues: traceEntry.defaultDependencyValues,
    });
    if (
      resolution.kind === "resolved" &&
      resolution.usedDefaults.length > 0 &&
      resolution.usedDefaults.every((used) => used)
    ) {
      return traceEntry.preliminaryResult as ValueParserResult<T>;
    }
  }
  const replayed = await replayDerivedParserAsync(
    {
      path: exec.path,
      parser: { dependencyMetadata: { derived: derivedMetadata.derived } },
      state,
      defaultDependencyValues: traceEntry.defaultDependencyValues,
    },
    traceEntry.rawInput,
    exec.dependencyRuntime,
  );
  return replayed as ValueParserResult<T> ??
    traceEntry.preliminaryResult as ValueParserResult<T> ??
    state;
}

import {
  type Message,
  message,
  metavar,
  optionName as eOptionName,
  optionNames as eOptionNames,
  text,
  valueSet,
} from "./message.ts";
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
import {
  createErrorWithSuggestions,
  createSuggestionMessage,
  DEFAULT_FIND_SIMILAR_OPTIONS,
  findSimilar,
} from "./suggestion.ts";
import type {
  HiddenVisibility,
  OptionName,
  Usage,
  UsageTerm,
} from "./usage.ts";
import {
  extractOptionNames,
  isDocHidden,
  isSuggestionHidden,
} from "./usage.ts";
import { extractLeadingCommandNames } from "./usage-internals.ts";
import {
  isValueParser,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";

/**
 * Creates a parser that always succeeds without consuming any input and
 * produces a constant value of the type {@link T}.
 * @template T The type of the constant value produced by the parser.
 */
export function constant<const T>(value: T): Parser<"sync", T, T> {
  const result: Parser<"sync", T, T> = {
    $valueType: [],
    $stateType: [],
    mode: "sync",
    priority: 0,
    usage: [],
    leadingNames: EMPTY_LEADING_NAMES,
    acceptingAnyToken: false,
    initialState: value,
    parse(context) {
      return { success: true, next: context, consumed: [] };
    },
    complete(state, _exec?: ExecutionContext) {
      return { success: true, value: state };
    },
    suggest(_context, _prefix) {
      return [];
    },
    getDocFragments(_state: DocState<T>, _defaultValue?) {
      return { fragments: [] };
    },
  };
  Object.defineProperty(result, "placeholder", {
    value,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return result;
}

/**
 * Creates a parser that always fails without consuming any input.
 *
 * This is the counterpart to {@link constant}: while `constant(value)` always
 * succeeds, `fail<T>()` always fails.  At the type level it is declared to
 * produce a value of type `T`, so it composes seamlessly with other parsers
 * that expect `Parser<"sync", T, …>`.
 *
 * The primary use case is as the inner parser for
 * `bindConfig(fail<T>(), { … })` when a value should *only* come from a
 * config file and has no corresponding CLI flag or argument.  Because `fail()`
 * always fails, `bindConfig` will always fall back to the config file (or the
 * supplied default).
 *
 * @template T The type of value this parser is declared to produce.
 * @returns A {@link Parser} that always fails at parse time and always fails at
 *          complete time.
 * @since 1.0.0
 */
export function fail<T>(): Parser<"sync", T, undefined> {
  return {
    $valueType: [],
    $stateType: [],
    mode: "sync",
    priority: 0,
    usage: [],
    leadingNames: EMPTY_LEADING_NAMES,
    acceptingAnyToken: false,
    initialState: undefined,
    parse(_context) {
      return {
        success: false,
        consumed: 0,
        error: message`No value provided.`,
      };
    },
    complete(_state, _exec?: ExecutionContext) {
      return {
        success: false,
        error: message`No value provided.`,
      };
    },
    suggest(_context, _prefix) {
      return [];
    },
    getDocFragments(_state, _defaultValue?) {
      return { fragments: [] };
    },
  };
}

/**
 * Options for the {@link option} parser.
 */
export interface OptionOptions {
  /**
   * The description of the option, which can be used for help messages.
   */
  readonly description?: Message;

  /**
   * Controls option visibility:
   *
   * - `true`: hide from usage, docs, and suggestions
   * - `"usage"`: hide from usage only
   * - `"doc"`: hide from docs only
   * - `"help"`: hide from usage and docs, keep suggestions
   *
   * @since 0.9.0
   */
  readonly hidden?: HiddenVisibility;

  /**
   * Error message customization options.
   * @since 0.5.0
   */
  readonly errors?: OptionErrorOptions;
}

/**
 * Options for customizing error messages in the {@link option} parser.
 * @since 0.5.0
 */
export interface OptionErrorOptions {
  /**
   * Custom error message when the option is missing (for required options).
   * Can be a static message or a function that receives the option names.
   */
  missing?: Message | ((optionNames: readonly string[]) => Message);

  /**
   * Custom error message when options are terminated (after `--`).
   */
  optionsTerminated?: Message;

  /**
   * Custom error message when input is empty but option is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when option is used multiple times.
   * Can be a static message or a function that receives the token.
   */
  duplicate?: Message | ((token: string) => Message);

  /**
   * Custom error message when value parsing fails.
   * Can be a static message or a function that receives the error message.
   */
  invalidValue?: Message | ((error: Message) => Message);

  /**
   * Custom error message when a Boolean flag receives an unexpected value.
   * Can be a static message or a function that receives the value.
   */
  unexpectedValue?: Message | ((value: string) => Message);

  /**
   * Custom error message when no matching option is found.
   * Can be a static message or a function that receives:
   * - invalidOption: The invalid option name that was provided
   * - suggestions: Array of similar valid option names (can be empty)
   *
   * @since 0.7.0
   */
  noMatch?:
    | Message
    | ((invalidOption: string, suggestions: readonly string[]) => Message);
}

/**
 * Internal helper to get suggestions from a value parser, using dependency values
 * if the parser is a derived parser and dependency values are available.
 * @internal
 */
function* getSuggestionsWithDependency<T>(
  valueParser: ValueParser<"sync", T>,
  prefix: string,
  dependencyRegistry: DependencyRegistryLike | undefined,
  exec?: ExecutionContext,
): Generator<Suggestion> {
  if (!valueParser.suggest) return;

  // Check if this is a derived parser with suggestWithDependency
  if (
    isDerivedValueParser(valueParser) && suggestWithDependency in valueParser
  ) {
    const derived = valueParser as DerivedValueParser<"sync", T, unknown>;
    const suggestWithDep = derived[suggestWithDependency];

    if (suggestWithDep && dependencyRegistry) {
      const dependencyRuntime = exec?.dependencyRuntime;
      // Get dependency values from registry
      const depIds = getDependencyIds(derived);
      const defaultsFn = getDefaultValuesFunction(derived);
      const defaults = defaultsFn?.();

      // Collect dependency values, using defaults for missing ones
      const dependencyValues: unknown[] = [];
      let hasAnyValue = false;

      for (let i = 0; i < depIds.length; i++) {
        const depId = depIds[i];
        if (dependencyRegistry.has(depId)) {
          dependencyValues.push(dependencyRegistry.get(depId));
          hasAnyValue = true;
        } else if (dependencyRuntime?.isSourceFailed(depId)) {
          return;
        } else if (defaults && i < defaults.length) {
          dependencyValues.push(defaults[i]);
        } else {
          // Can't resolve, fall back to default suggest
          yield* valueParser.suggest(prefix);
          return;
        }
      }

      // If we have at least one actual value (not just defaults), use suggestWithDependency
      if (hasAnyValue) {
        const depValue = depIds.length === 1
          ? dependencyValues[0]
          : dependencyValues;
        yield* suggestWithDep(prefix, depValue) as Iterable<Suggestion>;
        return;
      }
    }
  }

  // Fall back to default suggest
  yield* valueParser.suggest(prefix);
}

/**
 * Internal sync helper for option suggest functionality.
 * @internal
 */
function* suggestOptionSync<T>(
  optionNames: readonly string[],
  valueParser: ValueParser<"sync", T> | undefined,
  hidden: boolean,
  context: ParserContext<
    ValueParserResult<T | boolean> | undefined
  >,
  prefix: string,
): Generator<Suggestion> {
  if (hidden) return;

  // Check for --option=value format
  const equalsIndex = prefix.indexOf("=");
  if (equalsIndex >= 0) {
    // Handle --option=value completion
    const optionPart = prefix.slice(0, equalsIndex);
    const valuePart = prefix.slice(equalsIndex + 1);

    // Check if this option matches any of our option names
    if ((optionNames as readonly string[]).includes(optionPart)) {
      if (valueParser && valueParser.suggest) {
        const valueSuggestions = getSuggestionsWithDependency(
          valueParser,
          valuePart,
          context.dependencyRegistry,
          context.exec,
        );
        // Prepend the option= part to each suggestion
        for (const suggestion of valueSuggestions) {
          if (suggestion.kind === "literal") {
            yield {
              kind: "literal",
              text: `${optionPart}=${suggestion.text}`,
              description: suggestion.description,
            };
          } else {
            // For file suggestions, we can't easily combine with option= format
            // so we fall back to literal suggestions
            yield {
              kind: "literal",
              text: `${optionPart}=${suggestion.pattern || ""}`,
              description: suggestion.description,
            };
          }
        }
      }
    }
  } else {
    const expectingValue = context.buffer.length > 0 &&
      (optionNames as readonly string[]).includes(
        context.buffer[context.buffer.length - 1],
      );

    // If the prefix looks like an option prefix, suggest matching option names
    if (
      !expectingValue &&
      (prefix.startsWith("--") || prefix.startsWith("-") ||
        prefix.startsWith("/"))
    ) {
      for (const optionName of optionNames) {
        if (optionName.startsWith(prefix)) {
          // Special case: if prefix is exactly "-", only suggest short options
          if (prefix === "-" && optionName.length !== 2) {
            continue;
          }
          yield { kind: "literal", text: optionName };
        }
      }
    }

    // Check if we should suggest values for this option
    if (valueParser && valueParser.suggest) {
      let shouldSuggestValues = false;

      // Scenario 1: Buffer contains option name
      if (context.buffer.length > 0) {
        const lastToken = context.buffer[context.buffer.length - 1];
        if ((optionNames as readonly string[]).includes(lastToken)) {
          shouldSuggestValues = true;
        }
      } // Scenario 2: Empty buffer, state is undefined, and the prefix is
      // not itself starting an option token.
      else if (
        isAnnotationWrappedInitialState(context.state) &&
        context.buffer.length === 0 &&
        (context.exec?.path?.length ?? 0) === 0 &&
        !(prefix.startsWith("--") || prefix.startsWith("-") ||
          prefix.startsWith("/"))
      ) {
        shouldSuggestValues = true;
      }

      if (shouldSuggestValues) {
        yield* getSuggestionsWithDependency(
          valueParser,
          prefix,
          context.dependencyRegistry,
          context.exec,
        );
      }
    }
  }
}

/**
 * Internal async helper to get suggestions from a value parser, using dependency values
 * if the parser is a derived parser and dependency values are available.
 * @internal
 */
async function* getSuggestionsWithDependencyAsync<T>(
  valueParser: ValueParser<Mode, T>,
  prefix: string,
  dependencyRegistry: DependencyRegistryLike | undefined,
  exec?: ExecutionContext,
): AsyncGenerator<Suggestion> {
  if (!valueParser.suggest) return;

  // Check if this is a derived parser with suggestWithDependency
  if (
    isDerivedValueParser(valueParser) && suggestWithDependency in valueParser
  ) {
    const derived = valueParser as DerivedValueParser<Mode, T, unknown>;
    const suggestWithDep = derived[suggestWithDependency];

    if (suggestWithDep && dependencyRegistry) {
      const dependencyRuntime = exec?.dependencyRuntime;
      // Get dependency values from registry
      const depIds = getDependencyIds(derived);
      const defaultsFn = getDefaultValuesFunction(derived);
      const defaults = defaultsFn?.();

      // Collect dependency values, using defaults for missing ones
      const dependencyValues: unknown[] = [];
      let hasAnyValue = false;

      for (let i = 0; i < depIds.length; i++) {
        const depId = depIds[i];
        if (dependencyRegistry.has(depId)) {
          dependencyValues.push(dependencyRegistry.get(depId));
          hasAnyValue = true;
        } else if (dependencyRuntime?.isSourceFailed(depId)) {
          return;
        } else if (defaults && i < defaults.length) {
          dependencyValues.push(defaults[i]);
        } else {
          // Can't resolve, fall back to default suggest
          for await (const suggestion of valueParser.suggest(prefix)) {
            yield suggestion;
          }
          return;
        }
      }

      // If we have at least one actual value (not just defaults), use suggestWithDependency
      if (hasAnyValue) {
        const depValue = depIds.length === 1
          ? dependencyValues[0]
          : dependencyValues;
        for await (
          const suggestion of suggestWithDep(
            prefix,
            depValue,
          ) as AsyncIterable<Suggestion>
        ) {
          yield suggestion;
        }
        return;
      }
    }
  }

  // Fall back to default suggest
  for await (const suggestion of valueParser.suggest(prefix)) {
    yield suggestion;
  }
}

/**
 * Internal async helper for option suggest functionality.
 * @internal
 */
async function* suggestOptionAsync<T>(
  optionNames: readonly string[],
  valueParser: ValueParser<Mode, T> | undefined,
  hidden: boolean,
  context: ParserContext<
    ValueParserResult<T | boolean> | undefined
  >,
  prefix: string,
): AsyncGenerator<Suggestion> {
  if (hidden) return;

  // Check for --option=value format
  const equalsIndex = prefix.indexOf("=");
  if (equalsIndex >= 0) {
    // Handle --option=value completion
    const optionPart = prefix.slice(0, equalsIndex);
    const valuePart = prefix.slice(equalsIndex + 1);

    // Check if this option matches any of our option names
    if ((optionNames as readonly string[]).includes(optionPart)) {
      if (valueParser && valueParser.suggest) {
        const valueSuggestions = getSuggestionsWithDependencyAsync(
          valueParser,
          valuePart,
          context.dependencyRegistry,
          context.exec,
        );
        // Prepend the option= part to each suggestion - handle both sync and async
        for await (const suggestion of valueSuggestions) {
          if (suggestion.kind === "literal") {
            yield {
              kind: "literal",
              text: `${optionPart}=${suggestion.text}`,
              description: suggestion.description,
            };
          } else {
            // For file suggestions, we can't easily combine with option= format
            yield {
              kind: "literal",
              text: `${optionPart}=${suggestion.pattern || ""}`,
              description: suggestion.description,
            };
          }
        }
      }
    }
  } else {
    const expectingValue = context.buffer.length > 0 &&
      (optionNames as readonly string[]).includes(
        context.buffer[context.buffer.length - 1],
      );

    // If the prefix looks like an option prefix, suggest matching option names
    if (
      !expectingValue &&
      (prefix.startsWith("--") || prefix.startsWith("-") ||
        prefix.startsWith("/"))
    ) {
      for (const optionName of optionNames) {
        if (optionName.startsWith(prefix)) {
          // Special case: if prefix is exactly "-", only suggest short options
          if (prefix === "-" && optionName.length !== 2) {
            continue;
          }
          yield { kind: "literal", text: optionName };
        }
      }
    }

    // Check if we should suggest values for this option
    if (valueParser && valueParser.suggest) {
      let shouldSuggestValues = false;

      // Scenario 1: Buffer contains option name
      if (context.buffer.length > 0) {
        const lastToken = context.buffer[context.buffer.length - 1];
        if ((optionNames as readonly string[]).includes(lastToken)) {
          shouldSuggestValues = true;
        }
      } // Scenario 2: Empty buffer, state is undefined, and the prefix is
      // not itself starting an option token.
      else if (
        isAnnotationWrappedInitialState(context.state) &&
        context.buffer.length === 0 &&
        (context.exec?.path?.length ?? 0) === 0 &&
        !(prefix.startsWith("--") || prefix.startsWith("-") ||
          prefix.startsWith("/"))
      ) {
        shouldSuggestValues = true;
      }

      if (shouldSuggestValues) {
        for await (
          const suggestion of getSuggestionsWithDependencyAsync(
            valueParser,
            prefix,
            context.dependencyRegistry,
            context.exec,
          )
        ) {
          yield suggestion;
        }
      }
    }
  }
}

/**
 * Internal sync helper for argument suggest functionality.
 * @internal
 */
function* suggestArgumentSync<T>(
  valueParser: ValueParser<"sync", T>,
  hidden: boolean,
  prefix: string,
  dependencyRegistry: DependencyRegistryLike | undefined,
  exec?: ExecutionContext,
): Generator<Suggestion> {
  if (hidden) return;

  // Delegate to value parser if it has completion capabilities
  if (valueParser.suggest) {
    yield* getSuggestionsWithDependency(
      valueParser,
      prefix,
      dependencyRegistry,
      exec,
    );
  }
}

/**
 * Internal async helper for argument suggest functionality.
 * @internal
 */
async function* suggestArgumentAsync<T>(
  valueParser: ValueParser<Mode, T>,
  hidden: boolean,
  prefix: string,
  dependencyRegistry: DependencyRegistryLike | undefined,
  exec?: ExecutionContext,
): AsyncGenerator<Suggestion> {
  if (hidden) return;

  // Delegate to value parser if it has completion capabilities
  if (valueParser.suggest) {
    yield* getSuggestionsWithDependencyAsync(
      valueParser,
      prefix,
      dependencyRegistry,
      exec,
    );
  }
}

/**
 * Creates a parser for various styles of command-line options that take an
 * argument value, such as `--option=value`, `-option=value`, `-o value`,
 * or `/option:value`.
 * @template M The execution mode of the parser.
 * @template T The type of value this parser produces.
 * @param args The {@link OptionName}s to parse, followed by
 *             a {@link ValueParser} that defines how to parse the value of
 *             the option.  If no value parser is provided, the option is
 *             treated as a boolean flag.
 * @returns A {@link Parser} that can parse the specified options and their
 *          values.
 */
export function option<M extends Mode, T>(
  ...args: readonly [OptionName, ...readonly OptionName[], ValueParser<M, T>]
): Parser<M, T, ValueParserResult<T> | undefined>;

/**
 * Creates a parser for various styles of command-line options that take an
 * argument value, such as `--option=value`, `-option=value`, `-o value`,
 * or `/option:value`.
 * @template M The execution mode of the parser.
 * @template T The type of value this parser produces.
 * @param args The {@link OptionName}s to parse, followed by
 *             a {@link ValueParser} that defines how to parse the value of
 *             the option, and an optional {@link OptionOptions} object
 *             that allows you to specify a description or other metadata.
 * @returns A {@link Parser} that can parse the specified options and their
 *          values.
 */
export function option<M extends Mode, T>(
  ...args: readonly [
    OptionName,
    ...readonly OptionName[],
    ValueParser<M, T>,
    OptionOptions,
  ]
): Parser<M, T, ValueParserResult<T> | undefined>;

/**
 * Creates a parser for various styles of command-line options that do not
 * take an argument value, such as `--option`, `-o`, or `/option`.
 * @param optionNames The {@link OptionName}s to parse.
 * @return A {@link Parser} that can parse the specified options as Boolean
 *         flags, producing `true` if the option is present.
 */
export function option(
  ...optionNames: readonly [OptionName, ...readonly OptionName[]]
): Parser<"sync", boolean, ValueParserResult<boolean> | undefined>;

/**
 * Creates a parser for various styles of command-line options that take an
 * argument value, such as `--option=value`, `-option=value`, `-o value`,
 * or `/option:value`.
 * @param args The {@link OptionName}s to parse, followed by
 *             an optional {@link OptionOptions} object that allows you to
 *             specify a description or other metadata.
 * @returns A {@link Parser} that can parse the specified options and their
 *          values.
 */
export function option(
  ...args: readonly [OptionName, ...readonly OptionName[], OptionOptions]
): Parser<"sync", boolean, ValueParserResult<boolean> | undefined>;

export function option<M extends Mode, T>(
  ...args:
    | readonly [
      OptionName,
      ...readonly OptionName[],
      ValueParser<M, T>,
      OptionOptions,
    ]
    | readonly [OptionName, ...readonly OptionName[], ValueParser<M, T>]
    | readonly [OptionName, ...readonly OptionName[], OptionOptions]
    | readonly [OptionName, ...readonly OptionName[]]
): Parser<M, T | boolean, ValueParserResult<T | boolean> | undefined> {
  const lastArg = args.at(-1);
  const secondLastArg = args.at(-2);
  let valueParser: ValueParser<M, T> | undefined;
  let optionNames: readonly OptionName[];
  let options: OptionOptions = {};
  if (isValueParser<M, T>(lastArg)) {
    valueParser = lastArg;
    optionNames = args.slice(0, -1) as OptionName[];
  } else if (typeof lastArg === "object" && lastArg != null) {
    options = lastArg;
    if (isValueParser<M, T>(secondLastArg)) {
      valueParser = secondLastArg;
      optionNames = args.slice(0, -2) as OptionName[];
    } else {
      valueParser = undefined;
      optionNames = args.slice(0, -1) as OptionName[];
    }
  } else {
    optionNames = args as readonly OptionName[];
    valueParser = undefined;
  }
  validateOptionNames(optionNames, "Option");
  const mode: M = (valueParser?.mode ?? "sync") as M;
  const isAsync = mode === "async";
  const syncValueParser = valueParser as ValueParser<"sync", T> | undefined;
  const dependencyMetadata = valueParser != null
    ? extractDependencyMetadata(valueParser)
    : undefined;
  // Shared error formatter used by both complete() and validateValue()
  // so that fallback validation errors from bindEnv() / bindConfig()
  // carry the same option-name prefix and `options.errors.invalidValue`
  // customization as CLI-sourced errors (see issue #414).
  const formatInvalidValueError = (error: Message): Message =>
    options.errors?.invalidValue
      ? (typeof options.errors.invalidValue === "function"
        ? options.errors.invalidValue(error)
        : options.errors.invalidValue)
      : message`${eOptionNames(optionNames)}: ${error}`;

  // Use 'as any' to allow both sync and async returns from parse method
  // The actual mode is set correctly at the end via spread with mode
  const result = {
    mode: mode,
    $valueType: [],
    $stateType: [],
    priority: 10,
    usage: [
      valueParser == null
        ? {
          type: "optional",
          terms: [{
            type: "option",
            names: optionNames,
            ...(options.hidden != null && { hidden: options.hidden }),
          }],
        }
        : {
          type: "option",
          names: optionNames,
          metavar: valueParser.metavar,
          ...(options.hidden != null && { hidden: options.hidden }),
        },
    ],
    leadingNames: new Set<string>(optionNames),
    acceptingAnyToken: false,
    initialState: valueParser == null
      ? { success: true, value: false }
      : undefined,
    parse(
      context: ParserContext<
        ValueParserResult<T | boolean> | undefined
      >,
    ) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.optionsTerminated ??
            message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.endOfInput ??
            message`Expected an option, but got end of input.`,
        };
      }

      // When the input contains `--` it is a signal to stop parsing
      // options and treat the rest as positional arguments.
      if (context.buffer[0] === "--") {
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state,
            optionsTerminated: true,
          },
          consumed: context.buffer.slice(0, 1),
        };
      }

      // When the input is split by spaces, the first element is the option name
      // E.g., `--option value` or `/O value`
      if ((optionNames as string[]).includes(context.buffer[0])) {
        if (hasParsedOptionValue(context.state, valueParser)) {
          return {
            success: false,
            consumed: 1,
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(context.buffer[0])
                : options.errors.duplicate)
              : message`${
                eOptionName(context.buffer[0])
              } cannot be used multiple times.`,
          };
        }
        if (valueParser == null) {
          return {
            success: true,
            next: {
              ...context,
              state: { success: true, value: true },
              buffer: context.buffer.slice(1),
            },
            consumed: context.buffer.slice(0, 1),
          };
        }
        if (context.buffer.length < 2) {
          return {
            success: false,
            consumed: 1,
            error: options.errors?.endOfInput ??
              message`${eOptionName(context.buffer[0])} requires ${
                metavar(valueParser.metavar)
              }.`,
          };
        }
        const rawInput = context.buffer[1];
        return dispatchByMode(
          mode,
          () => {
            const parseResult = syncValueParser!.parse(rawInput);
            const next = recordTrace(
              context,
              buildTraceEntry(
                "option-value",
                rawInput,
                context.buffer.slice(0, 2),
                syncValueParser!,
                parseResult,
                optionNames,
              ),
            );
            return {
              success: true as const,
              next: {
                ...next,
                state: createOptionParseState(parseResult),
                buffer: context.buffer.slice(2),
              },
              consumed: context.buffer.slice(0, 2),
            };
          },
          async () => {
            const parseResult = await valueParser!.parse(rawInput);
            const next = recordTrace(
              context,
              buildTraceEntry(
                "option-value",
                rawInput,
                context.buffer.slice(0, 2),
                valueParser!,
                parseResult,
                optionNames,
              ),
            );
            return {
              success: true as const,
              next: {
                ...next,
                state: createOptionParseState(parseResult),
                buffer: context.buffer.slice(2),
              },
              consumed: context.buffer.slice(0, 2),
            };
          },
        );
      }

      // When the input is not split by spaces, but joined by = or :
      // E.g., `--option=value` or `/O:value`
      const prefixes = optionNames
        .filter((name) =>
          name.startsWith("--") ||
          name.startsWith("/") ||
          (name.startsWith("-") && name.length > 2)
        )
        .map((name) => name.startsWith("/") ? `${name}:` : `${name}=`);
      for (const prefix of prefixes) {
        if (!context.buffer[0].startsWith(prefix)) continue;
        if (hasParsedOptionValue(context.state, valueParser)) {
          const optionName = prefix.slice(0, -1);
          return {
            success: false,
            consumed: 1,
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(prefix)
                : options.errors.duplicate)
              : message`${
                eOptionName(optionName)
              } cannot be used multiple times.`,
          };
        }
        const rawInput = context.buffer[0].slice(prefix.length);
        if (valueParser == null) {
          return {
            success: false,
            consumed: 1,
            error: options.errors?.unexpectedValue
              ? (typeof options.errors.unexpectedValue === "function"
                ? options.errors.unexpectedValue(rawInput)
                : options.errors.unexpectedValue)
              : message`Option ${
                eOptionName(prefix)
              } is a Boolean flag, but got a value: ${rawInput}.`,
          };
        }
        return dispatchByMode(
          mode,
          () => {
            const parseResult = syncValueParser!.parse(rawInput);
            const next = recordTrace(
              context,
              buildTraceEntry(
                "option-value",
                rawInput,
                context.buffer.slice(0, 1),
                syncValueParser!,
                parseResult,
                optionNames,
              ),
            );
            return {
              success: true as const,
              next: {
                ...next,
                state: createOptionParseState(parseResult),
                buffer: context.buffer.slice(1),
              },
              consumed: context.buffer.slice(0, 1),
            };
          },
          async () => {
            const parseResult = await valueParser.parse(rawInput);
            const next = recordTrace(
              context,
              buildTraceEntry(
                "option-value",
                rawInput,
                context.buffer.slice(0, 1),
                valueParser,
                parseResult,
                optionNames,
              ),
            );
            return {
              success: true as const,
              next: {
                ...next,
                state: createOptionParseState(parseResult),
                buffer: context.buffer.slice(1),
              },
              consumed: context.buffer.slice(0, 1),
            };
          },
        );
      }

      if (valueParser == null) {
        // When the input contains bundled options, e.g., `-abc`
        const shortOptions = optionNames.filter(
          (name) => name.match(/^-[^-]$/),
        );
        for (const shortOption of shortOptions) {
          if (!context.buffer[0].startsWith(shortOption)) continue;
          if (hasParsedOptionValue(context.state, valueParser)) {
            return {
              success: false,
              consumed: 1,
              error: options.errors?.duplicate
                ? (typeof options.errors.duplicate === "function"
                  ? options.errors.duplicate(shortOption)
                  : options.errors.duplicate)
                : message`${
                  eOptionName(shortOption)
                } cannot be used multiple times.`,
            };
          }
          return {
            success: true,
            next: {
              ...context,
              state: { success: true, value: true },
              buffer: [
                `-${context.buffer[0].slice(2)}`,
                ...context.buffer.slice(1),
              ],
            },
            consumed: [context.buffer[0].slice(0, 2)],
          };
        }
      }

      // Find similar options from context usage and suggest them
      const invalidOption = context.buffer[0];

      // Check if custom noMatch error is provided
      if (options.errors?.noMatch) {
        const candidates = new Set<string>();
        for (const name of extractOptionNames(context.usage)) {
          candidates.add(name);
        }
        const suggestions = findSimilar(
          invalidOption,
          candidates,
          DEFAULT_FIND_SIMILAR_OPTIONS,
        );

        const errorMessage = typeof options.errors.noMatch === "function"
          ? options.errors.noMatch(invalidOption, suggestions)
          : options.errors.noMatch;

        return {
          success: false,
          consumed: 0,
          error: errorMessage,
        };
      }

      const baseError = message`No matched option for ${
        eOptionName(invalidOption)
      }.`;

      return {
        success: false,
        consumed: 0,
        error: createErrorWithSuggestions(
          baseError,
          invalidOption,
          context.usage,
          "option",
        ),
      };
    },
    complete(
      state: ValueParserResult<T | boolean> | undefined,
      exec?: ExecutionContext,
    ): ModeValue<M, ValueParserResult<T | boolean>> {
      const missing = valueParser == null
        ? { success: true as const, value: false }
        : {
          success: false as const,
          error: options.errors?.missing
            ? (typeof options.errors.missing === "function"
              ? options.errors.missing(optionNames)
              : options.errors.missing)
            : message`Missing option ${eOptionNames(optionNames)}.`,
        };
      const completeSync = (): ValueParserResult<T | boolean> => {
        if (state == null) return missing;
        const resolvedState = valueParser != null &&
            dependencyMetadata?.derived != null
          ? resolveDerivedCompletionSync(
            dependencyMetadata,
            state as ValueParserResult<T>,
            exec,
          ) as ValueParserResult<T | boolean>
          : state;
        return resolvedState.success ? resolvedState : {
          success: false,
          error: formatInvalidValueError(resolvedState.error),
        };
      };
      const completeAsync = async (): Promise<
        ValueParserResult<T | boolean>
      > => {
        if (state == null) return missing;
        if (valueParser == null || dependencyMetadata?.derived == null) {
          return completeSync();
        }
        const resolved = await resolveDerivedCompletionAsync(
          dependencyMetadata,
          state as ValueParserResult<T>,
          exec,
        );
        return resolved.success ? resolved : {
          success: false,
          error: formatInvalidValueError(resolved.error),
        };
      };
      return dispatchByMode(
        mode,
        completeSync,
        completeAsync,
      );
    },
    suggest(
      context: ParserContext<
        ValueParserResult<T | boolean> | undefined
      >,
      prefix: string,
    ) {
      // For async parsers, use async generator; for sync parsers, use sync generator
      if (isAsync) {
        return suggestOptionAsync(
          optionNames,
          valueParser,
          isSuggestionHidden(options.hidden),
          context,
          prefix,
        );
      }
      return suggestOptionSync(
        optionNames,
        valueParser as ValueParser<"sync", T> | undefined,
        isSuggestionHidden(options.hidden),
        context,
        prefix,
      );
    },
    getDocFragments(
      _state: DocState<ValueParserResult<T | boolean> | undefined>,
      defaultValue?: T | boolean,
    ) {
      if (isDocHidden(options.hidden)) {
        return { fragments: [], description: options.description };
      }
      const choicesMessage: Message | undefined =
        valueParser?.choices != null && valueParser.choices.length > 0
          ? valueSet(
            valueParser.choices.map((c) => valueParser.format(c)),
            { fallback: "", type: "unit" },
          )
          : undefined;
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term: {
          type: "option",
          names: optionNames,
          metavar: valueParser?.metavar,
        },
        description: options.description,
        default: defaultValue != null && valueParser != null
          ? message`${valueParser.format(defaultValue as T)}`
          : undefined,
        choices: choicesMessage,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `option(${optionNames.map((o) => JSON.stringify(o)).join(", ")})`;
    },
  };
  // Define normalizeValue as non-enumerable so that ...parser spread in
  // map() does not propagate the inner normalizer to the mapped type.
  // Delegates to ValueParser.normalize() directly so that custom parsers
  // with lossy format() or non-string types are handled correctly.
  if (valueParser != null && typeof valueParser.normalize === "function") {
    const normalize = valueParser.normalize.bind(valueParser);
    Object.defineProperty(result, "normalizeValue", {
      value(v: T | boolean): T | boolean {
        try {
          return normalize(v as T);
        } catch {
          return v;
        }
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Define validateValue as non-enumerable so that ...parser spread in
  // map() does not propagate it to the mapped type (see issue #414).
  // Re-validates a value as if it had been parsed from CLI input by
  // round-tripping through ValueParser.format() + ValueParser.parse().
  // Used by bindEnv() and bindConfig() to enforce parser constraints
  // on fallback values.
  //
  // Derived value parsers (`deriveFrom`) are exempt: their `format()`
  // rebuilds the parser from *default* dependency values rather than
  // the live ones resolved at parse time, so a format+parse round-trip
  // would validate against the wrong branch.  For those parsers we
  // return the value unchanged instead of mis-validating.
  if (valueParser == null) {
    // Flag-form option (no value parser): the runtime value is a plain
    // boolean — `true` when the flag is present and `false` when it is
    // missing (see `option().complete()`).  There are no shape
    // constraints to enforce, but fallback values from `bindEnv()` /
    // `bindConfig()` originate in `unknown`-typed config / env sources
    // and a non-boolean would otherwise leak through as the parsed
    // result.  Reject non-booleans with an option-scoped error and
    // accept any boolean unchanged.  Having *some* validator attached
    // also lets bindEnv(flag-form) / bindConfig(flag-form) forward
    // validateValue through downstream wrappers without losing the hook.
    Object.defineProperty(result, "validateValue", {
      value(v: boolean): ModeValue<M, ValueParserResult<boolean>> {
        if (typeof v !== "boolean") {
          const actualType = v === null ? "null" : typeof v;
          return wrapForMode(mode, {
            success: false as const,
            error: formatInvalidValueError(
              message`Expected a boolean value, but received ${actualType}.`,
            ),
          });
        }
        return wrapForMode(mode, { success: true as const, value: v });
      },
      configurable: true,
      enumerable: false,
    });
  } else if (!isDerivedValueParser(valueParser)) {
    const vp = valueParser;
    // Wraps a ValueParser.parse() failure with the same option-scoped
    // error formatting that `complete()` applies to CLI-sourced errors,
    // so fallback validation failures look identical to CLI failures.
    const wrapParseResult = (
      parsed: ValueParserResult<T>,
    ): ValueParserResult<T | boolean> =>
      parsed.success
        ? parsed
        : { success: false, error: formatInvalidValueError(parsed.error) };
    Object.defineProperty(result, "validateValue", {
      value(
        v: T | boolean,
      ): ModeValue<M, ValueParserResult<T | boolean>> {
        let stringified: string;
        try {
          stringified = vp.format(v as T);
        } catch {
          // format() may throw for sentinel defaults whose type cannot
          // be serialized by this value parser.  Skip validation and
          // return success unchanged so sentinel-default users are
          // not broken.
          return wrapForMode(mode, {
            success: true as const,
            value: v,
          });
        }
        if (typeof stringified !== "string") {
          // A non-string serialization is unsupported for the round-
          // trip; skip validation rather than crashing.
          return wrapForMode(mode, {
            success: true as const,
            value: v,
          });
        }
        return dispatchByMode(
          mode,
          () =>
            wrapParseResult(
              (vp as ValueParser<"sync", T>).parse(stringified),
            ),
          async () => wrapParseResult(await vp.parse(stringified)),
        );
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Define placeholder lazily to avoid triggering derived value parser
  // factory functions during parser construction.  Non-enumerable so that
  // ...parser spread in map() does not eagerly evaluate the getter.
  if (valueParser != null) {
    Object.defineProperty(result, "placeholder", {
      get() {
        try {
          return valueParser!.placeholder;
        } catch {
          return undefined;
        }
      },
      configurable: true,
      enumerable: false,
    });
  } else {
    Object.defineProperty(result, "placeholder", {
      value: false,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  // Populate dependency metadata from the value parser's markers.
  if (dependencyMetadata != null) {
    Object.defineProperty(result, "dependencyMetadata", {
      value: dependencyMetadata,
      configurable: true,
      enumerable: false,
    });
  }
  // Type assertion via 'unknown' needed because TypeScript's conditional type
  // ModeValue<M, T> cannot be verified when M is a generic type parameter.
  // At runtime, the isAsync flag ensures correct behavior:
  // - When M = "sync": parse() returns ParserResult directly
  // - When M = "async": parse() returns Promise<ParserResult>
  return result as unknown as Parser<
    M,
    T | boolean,
    ValueParserResult<T | boolean> | undefined
  >;
}

/**
 * Options for the {@link flag} parser.
 */
export interface FlagOptions {
  /**
   * The description of the flag, which can be used for help messages.
   */
  readonly description?: Message;

  /**
   * Controls flag visibility:
   *
   * - `true`: hide from usage, docs, and suggestions
   * - `"usage"`: hide from usage only
   * - `"doc"`: hide from docs only
   * - `"help"`: hide from usage and docs, keep suggestions
   *
   * @since 0.9.0
   */
  readonly hidden?: HiddenVisibility;

  /**
   * Error message customization options.
   * @since 0.5.0
   */
  readonly errors?: FlagErrorOptions;
}

/**
 * Options for customizing error messages in the {@link flag} parser.
 * @since 0.5.0
 */
export interface FlagErrorOptions {
  /**
   * Custom error message when the flag is missing (for required flags).
   * Can be a static message or a function that receives the option names.
   */
  missing?: Message | ((optionNames: readonly string[]) => Message);

  /**
   * Custom error message when options are terminated (after --).
   */
  optionsTerminated?: Message;

  /**
   * Custom error message when input is empty but flag is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when flag is used multiple times.
   * Can be a static message or a function that receives the token.
   */
  duplicate?: Message | ((token: string) => Message);

  /**
   * Custom error message when no matching flag is found.
   * Can be a static message or a function that receives:
   * - invalidOption: The invalid option name that was provided
   * - suggestions: Array of similar valid option names (can be empty)
   *
   * @since 0.7.0
   */
  noMatch?:
    | Message
    | ((invalidOption: string, suggestions: readonly string[]) => Message);
}

/**
 * Creates a parser for command-line flags that must be explicitly provided.
 * Unlike {@link option}, this parser fails if the flag is not present, making
 * it suitable for required boolean flags that don't have a meaningful default.
 *
 * The key difference from {@link option} is:
 * - {@link option} without a value parser: Returns `false` when not present
 * - {@link flag}: Fails parsing when not present, only produces `true`
 *
 * This is useful for dependent options where the presence of a flag changes
 * the shape of the result type.
 *
 * @param args The {@link OptionName}s to parse, followed by an optional
 *             {@link FlagOptions} object that allows you to specify
 *             a description or other metadata.
 * @returns A {@link Parser} that produces `true` when the flag is present
 *          and fails when it is not present.
 *
 * @example
 * ```typescript
 * // Basic flag usage
 * const parser = flag("-f", "--force");
 * // Succeeds with true: parse(parser, ["-f"])
 * // Fails: parse(parser, [])
 *
 * // With description
 * const verboseFlag = flag("-v", "--verbose", {
 *   description: "Enable verbose output"
 * });
 * ```
 */
export function flag(
  ...args:
    | readonly [OptionName, ...readonly OptionName[], FlagOptions]
    | readonly [OptionName, ...readonly OptionName[]]
): Parser<"sync", true, ValueParserResult<true> | undefined> {
  const lastArg = args.at(-1);
  let optionNames: readonly OptionName[];
  let options: FlagOptions = {};

  if (
    typeof lastArg === "object" && lastArg != null && !Array.isArray(lastArg)
  ) {
    options = lastArg as FlagOptions;
    optionNames = args.slice(0, -1) as OptionName[];
  } else {
    optionNames = args as readonly OptionName[];
  }
  validateOptionNames(optionNames, "Flag");

  const result: Parser<"sync", true, ValueParserResult<true> | undefined> = {
    $valueType: [],
    $stateType: [],
    mode: "sync",
    priority: 10,
    usage: [{
      type: "option",
      names: optionNames,
      ...(options.hidden != null && { hidden: options.hidden }),
    }],
    leadingNames: new Set<string>(optionNames),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.optionsTerminated ??
            message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.endOfInput ??
            message`Expected an option, but got end of input.`,
        };
      }

      // When the input contains `--` it is a signal to stop parsing
      // options and treat the rest as positional arguments.
      if (context.buffer[0] === "--") {
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state,
            optionsTerminated: true,
          },
          consumed: context.buffer.slice(0, 1),
        };
      }

      // When the input is split by spaces, the first element is the option name
      if ((optionNames as string[]).includes(context.buffer[0])) {
        if (context.state?.success) {
          return {
            success: false,
            consumed: 1,
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(context.buffer[0])
                : options.errors.duplicate)
              : message`${
                eOptionName(context.buffer[0])
              } cannot be used multiple times.`,
          };
        }
        return {
          success: true,
          next: {
            ...context,
            state: { success: true, value: true },
            buffer: context.buffer.slice(1),
          },
          consumed: context.buffer.slice(0, 1),
        };
      }

      // Check for joined format (e.g., --flag=value) which should fail for flags
      const prefixes = optionNames
        .filter((name) =>
          name.startsWith("--") ||
          name.startsWith("/") ||
          (name.startsWith("-") && name.length > 2)
        )
        .map((name) => name.startsWith("/") ? `${name}:` : `${name}=`);
      for (const prefix of prefixes) {
        if (context.buffer[0].startsWith(prefix)) {
          const value = context.buffer[0].slice(prefix.length);
          return {
            success: false,
            consumed: 1,
            error: message`Flag ${
              eOptionName(prefix.slice(0, -1))
            } does not accept a value, but got: ${value}.`,
          };
        }
      }

      // When the input contains bundled options, e.g., `-abc`
      const shortOptions = optionNames.filter(
        (name) => name.match(/^-[^-]$/),
      );
      for (const shortOption of shortOptions) {
        if (!context.buffer[0].startsWith(shortOption)) continue;
        if (context.state?.success) {
          return {
            success: false,
            consumed: 1,
            error: options.errors?.duplicate
              ? (typeof options.errors.duplicate === "function"
                ? options.errors.duplicate(shortOption)
                : options.errors.duplicate)
              : message`${
                eOptionName(shortOption)
              } cannot be used multiple times.`,
          };
        }
        return {
          success: true,
          next: {
            ...context,
            state: { success: true, value: true },
            buffer: [
              `-${context.buffer[0].slice(2)}`,
              ...context.buffer.slice(1),
            ],
          },
          consumed: [context.buffer[0].slice(0, 2)],
        };
      }

      // Find similar options from context usage and suggest them
      const invalidOption = context.buffer[0];

      // Check if custom noMatch error is provided
      if (options.errors?.noMatch) {
        const candidates = new Set<string>();
        for (const name of extractOptionNames(context.usage)) {
          candidates.add(name);
        }
        const suggestions = findSimilar(
          invalidOption,
          candidates,
          DEFAULT_FIND_SIMILAR_OPTIONS,
        );

        const errorMessage = typeof options.errors.noMatch === "function"
          ? options.errors.noMatch(invalidOption, suggestions)
          : options.errors.noMatch;

        return {
          success: false,
          consumed: 0,
          error: errorMessage,
        };
      }

      const baseError = message`No matched option for ${
        eOptionName(invalidOption)
      }.`;

      return {
        success: false,
        consumed: 0,
        error: createErrorWithSuggestions(
          baseError,
          invalidOption,
          context.usage,
          "option",
        ),
      };
    },
    complete(state, _exec?: ExecutionContext) {
      if (state == null) {
        return {
          success: false,
          error: options.errors?.missing
            ? (typeof options.errors.missing === "function"
              ? options.errors.missing(optionNames)
              : options.errors.missing)
            : message`Required flag ${eOptionNames(optionNames)} is missing.`,
        };
      }
      if (state.success) return { success: true, value: true };
      return {
        success: false,
        error: message`${eOptionNames(optionNames)}: ${state.error}`,
      };
    },
    suggest(_context, prefix) {
      if (isSuggestionHidden(options.hidden)) {
        return [];
      }
      const suggestions: Suggestion[] = [];

      // If the prefix looks like an option prefix, suggest matching option names
      if (
        prefix.startsWith("--") || prefix.startsWith("-") ||
        prefix.startsWith("/")
      ) {
        for (const optionName of optionNames) {
          if (optionName.startsWith(prefix)) {
            // Special case: if prefix is exactly "-", only suggest short options (single dash + single char)
            if (prefix === "-" && optionName.length !== 2) {
              continue;
            }
            suggestions.push({ kind: "literal", text: optionName });
          }
        }
      }

      return suggestions;
    },
    getDocFragments(
      _state: DocState<ValueParserResult<true> | undefined>,
      _defaultValue?,
    ) {
      if (isDocHidden(options.hidden)) {
        return { fragments: [], description: options.description };
      }
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term: {
          type: "option",
          names: optionNames,
        },
        description: options.description,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `flag(${optionNames.map((o) => JSON.stringify(o)).join(", ")})`;
    },
  };
  // Non-enumerable so that ...parser spread in map() does not
  // eagerly evaluate the getter.
  Object.defineProperty(result, "placeholder", {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return result;
}

/**
 * A non-empty list of option names, or a single option name.
 * @since 1.1.0
 */
export type NegatableFlagNameList =
  | OptionName
  | readonly [OptionName, ...readonly OptionName[]];

/**
 * Option names for the {@link negatableFlag} parser.
 * @since 1.1.0
 */
export interface NegatableFlagNames {
  /**
   * Option names that produce `true`.
   */
  readonly positive: NegatableFlagNameList;

  /**
   * Option names that produce `false`.
   */
  readonly negative: NegatableFlagNameList;
}

/**
 * Options for the {@link negatableFlag} parser.
 * @since 1.1.0
 */
export interface NegatableFlagOptions {
  /**
   * The description of the flag pair, which can be used for help messages.
   */
  readonly description?: Message;

  /**
   * Controls flag visibility:
   *
   * - `true`: hide from usage, docs, and suggestions
   * - `"usage"`: hide from usage only
   * - `"doc"`: hide from docs only
   * - `"help"`: hide from usage and docs, keep suggestions
   */
  readonly hidden?: HiddenVisibility;

  /**
   * Error message customization options.
   */
  readonly errors?: NegatableFlagErrorOptions;
}

/**
 * Options for customizing error messages in the {@link negatableFlag} parser.
 * @since 1.1.0
 */
export interface NegatableFlagErrorOptions {
  /**
   * Custom error message when neither flag is provided.
   * Can be a static message or a function that receives the positive and
   * negative option names.
   */
  missing?:
    | Message
    | ((
      positiveNames: readonly string[],
      negativeNames: readonly string[],
    ) => Message);

  /**
   * Custom error message when options are terminated (after --).
   */
  optionsTerminated?: Message;

  /**
   * Custom error message when input is empty but a flag is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when the same polarity is used multiple times.
   */
  duplicate?: Message | ((token: string) => Message);

  /**
   * Custom error message when both positive and negative flags are used.
   */
  conflict?:
    | Message
    | ((previousToken: string, token: string) => Message);

  /**
   * Custom error message when a flag receives an unexpected value.
   */
  unexpectedValue?:
    | Message
    | ((optionName: string, value: string) => Message);

  /**
   * Custom error message when no matching flag is found.
   */
  noMatch?:
    | Message
    | ((invalidOption: string, suggestions: readonly string[]) => Message);
}

/**
 * State stored by the {@link negatableFlag} parser.
 * @since 1.1.0
 */
export type NegatableFlagState =
  | {
    readonly success: true;
    readonly value: boolean;
    readonly token: string;
  }
  | {
    readonly success: false;
    readonly error: Message;
  };

function normalizeNegatableFlagNameList(
  names: NegatableFlagNameList,
): readonly OptionName[] {
  return typeof names === "string" ? [names] : names;
}

function validateNoDuplicateOptionNames(
  names: readonly OptionName[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new TypeError(`${label} has a duplicate name: "${name}".`);
    }
    seen.add(name);
  }
}

function validateNoNegatableFlagNameCollision(
  positiveNames: readonly OptionName[],
  negativeNames: readonly OptionName[],
): void {
  const positiveSet = new Set<string>(positiveNames);
  for (const name of negativeNames) {
    if (positiveSet.has(name)) {
      throw new TypeError(
        `Negatable flag name is both positive and negative: "${name}".`,
      );
    }
  }
}

function formatNegatableFlagDuplicateError(
  options: NegatableFlagOptions,
  token: string,
): Message {
  return options.errors?.duplicate
    ? (typeof options.errors.duplicate === "function"
      ? options.errors.duplicate(token)
      : options.errors.duplicate)
    : message`${eOptionName(token)} cannot be used multiple times.`;
}

function formatNegatableFlagConflictError(
  options: NegatableFlagOptions,
  previousToken: string,
  token: string,
): Message {
  return options.errors?.conflict
    ? (typeof options.errors.conflict === "function"
      ? options.errors.conflict(previousToken, token)
      : options.errors.conflict)
    : message`${eOptionName(previousToken)} and ${
      eOptionName(token)
    } cannot be used together.`;
}

function formatNegatableFlagUnexpectedValueError(
  options: NegatableFlagOptions,
  optionName: string,
  value: string,
): Message {
  return options.errors?.unexpectedValue
    ? (typeof options.errors.unexpectedValue === "function"
      ? options.errors.unexpectedValue(optionName, value)
      : options.errors.unexpectedValue)
    : message`Flag ${
      eOptionName(optionName)
    } does not accept a value, but got: ${value}.`;
}

function parseMatchedNegatableFlag(
  context: ParserContext<NegatableFlagState | undefined>,
  token: string,
  value: boolean,
  consumed: readonly string[],
  consumedOnFailure: number,
  buffer: readonly string[],
  options: NegatableFlagOptions,
): ParserResult<NegatableFlagState> {
  if (context.state?.success) {
    return {
      success: false,
      consumed: consumedOnFailure,
      error: context.state.value === value
        ? formatNegatableFlagDuplicateError(options, token)
        : formatNegatableFlagConflictError(options, context.state.token, token),
    };
  }
  return {
    success: true,
    next: {
      ...context,
      state: { success: true, value, token },
      buffer,
    },
    consumed,
  };
}

/**
 * Creates a parser for a pair of command-line flags that explicitly enable or
 * disable a Boolean value.
 *
 * The positive names produce `true`; the negative names produce `false`.
 * Unlike {@link option}, this parser fails when neither side is present,
 * matching {@link flag} semantics. Wrap it in {@link optional} for a
 * tri-state override or {@link withDefault} for a concrete fallback.
 *
 * @param names The positive and negative option names to parse.
 * @param options Optional metadata and error customization.
 * @returns A {@link Parser} that produces `true` for positive names and
 *          `false` for negative names.
 * @since 1.1.0
 */
export function negatableFlag(
  names: NegatableFlagNames,
  options: NegatableFlagOptions = {},
): Parser<"sync", boolean, NegatableFlagState | undefined> {
  const positiveNames = normalizeNegatableFlagNameList(names.positive);
  const negativeNames = normalizeNegatableFlagNameList(names.negative);
  validateOptionNames(positiveNames, "Positive flag");
  validateOptionNames(negativeNames, "Negative flag");
  validateNoDuplicateOptionNames(positiveNames, "Positive flag");
  validateNoDuplicateOptionNames(negativeNames, "Negative flag");
  validateNoNegatableFlagNameCollision(positiveNames, negativeNames);

  const optionNames = [...positiveNames, ...negativeNames];
  const valueByName = new Map<string, boolean>();
  for (const name of positiveNames) valueByName.set(name, true);
  for (const name of negativeNames) valueByName.set(name, false);

  const result: Parser<"sync", boolean, NegatableFlagState | undefined> = {
    $valueType: [],
    $stateType: [],
    mode: "sync",
    priority: 10,
    usage: [{
      type: "option",
      names: optionNames,
      ...(options.hidden != null && { hidden: options.hidden }),
    }],
    leadingNames: new Set<string>(optionNames),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.optionsTerminated ??
            message`No more options can be parsed.`,
        };
      } else if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.endOfInput ??
            message`Expected an option, but got end of input.`,
        };
      }

      if (context.buffer[0] === "--") {
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state,
            optionsTerminated: true,
          },
          consumed: context.buffer.slice(0, 1),
        };
      }

      const directValue = valueByName.get(context.buffer[0]);
      if (directValue != null) {
        return parseMatchedNegatableFlag(
          context,
          context.buffer[0],
          directValue,
          context.buffer.slice(0, 1),
          1,
          context.buffer.slice(1),
          options,
        );
      }

      const prefixes = optionNames
        .filter((name) =>
          name.startsWith("--") ||
          name.startsWith("/") ||
          (name.startsWith("-") && name.length > 2)
        )
        .map((name) => name.startsWith("/") ? `${name}:` : `${name}=`);
      for (const prefix of prefixes) {
        if (context.buffer[0].startsWith(prefix)) {
          const value = context.buffer[0].slice(prefix.length);
          return {
            success: false,
            consumed: 1,
            error: formatNegatableFlagUnexpectedValueError(
              options,
              prefix.slice(0, -1),
              value,
            ),
          };
        }
      }

      const shortOptions = optionNames.filter((name) => name.match(/^-[^-]$/));
      for (const shortOption of shortOptions) {
        if (!context.buffer[0].startsWith(shortOption)) continue;
        return parseMatchedNegatableFlag(
          context,
          shortOption,
          valueByName.get(shortOption)!,
          [context.buffer[0].slice(0, 2)],
          1,
          [`-${context.buffer[0].slice(2)}`, ...context.buffer.slice(1)],
          options,
        );
      }

      const invalidOption = context.buffer[0];
      if (options.errors?.noMatch) {
        const candidates = new Set<string>();
        for (const name of extractOptionNames(context.usage)) {
          candidates.add(name);
        }
        const suggestions = findSimilar(
          invalidOption,
          candidates,
          DEFAULT_FIND_SIMILAR_OPTIONS,
        );
        return {
          success: false,
          consumed: 0,
          error: typeof options.errors.noMatch === "function"
            ? options.errors.noMatch(invalidOption, suggestions)
            : options.errors.noMatch,
        };
      }

      const baseError = message`No matched option for ${
        eOptionName(invalidOption)
      }.`;
      return {
        success: false,
        consumed: 0,
        error: createErrorWithSuggestions(
          baseError,
          invalidOption,
          context.usage,
          "option",
        ),
      };
    },
    complete(state, _exec?: ExecutionContext) {
      if (state == null) {
        return {
          success: false,
          error: options.errors?.missing
            ? (typeof options.errors.missing === "function"
              ? options.errors.missing(positiveNames, negativeNames)
              : options.errors.missing)
            : message`Required flag ${eOptionNames(optionNames)} is missing.`,
        };
      }
      if (state.success) {
        return { success: true, value: state.value };
      }
      return {
        success: false,
        error: message`${eOptionNames(optionNames)}: ${state.error}`,
      };
    },
    suggest(_context, prefix) {
      if (isSuggestionHidden(options.hidden)) {
        return [];
      }
      const suggestions: Suggestion[] = [];
      if (
        prefix.startsWith("--") || prefix.startsWith("-") ||
        prefix.startsWith("/")
      ) {
        for (const optionName of optionNames) {
          if (optionName.startsWith(prefix)) {
            if (prefix === "-" && optionName.length !== 2) {
              continue;
            }
            suggestions.push({ kind: "literal", text: optionName });
          }
        }
      }
      return suggestions;
    },
    getDocFragments(
      _state: DocState<NegatableFlagState | undefined>,
      _defaultValue?,
    ) {
      if (isDocHidden(options.hidden)) {
        return { fragments: [], description: options.description };
      }
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term: {
          type: "option",
          names: optionNames,
        },
        description: options.description,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      const args = [
        `positive: ${JSON.stringify(positiveNames)}`,
        `negative: ${JSON.stringify(negativeNames)}`,
      ];
      return `negatableFlag({ ${args.join(", ")} })`;
    },
  };
  Object.defineProperty(result, "placeholder", {
    value: false,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return result;
}

/**
 * Options for the {@link argument} parser.
 */
export interface ArgumentOptions {
  /**
   * The description of the argument, which can be used for help messages.
   */
  readonly description?: Message;

  /**
   * Controls argument visibility:
   *
   * - `true`: hide from usage, docs, and suggestions
   * - `"usage"`: hide from usage only
   * - `"doc"`: hide from docs only
   * - `"help"`: hide from usage and docs, keep suggestions
   *
   * @since 0.9.0
   */
  readonly hidden?: HiddenVisibility;

  /**
   * Error message customization options.
   * @since 0.5.0
   */
  readonly errors?: ArgumentErrorOptions;
}

/**
 * Options for customizing error messages in the {@link argument} parser.
 * @since 0.5.0
 */
export interface ArgumentErrorOptions {
  /**
   * Custom error message when input is empty but argument is expected.
   */
  endOfInput?: Message;

  /**
   * Custom error message when value parsing fails.
   * Can be a static message or a function that receives the error message.
   */
  invalidValue?: Message | ((error: Message) => Message);

  /**
   * Custom error message when argument is used multiple times.
   * Can be a static message or a function that receives the metavar.
   */
  multiple?: Message | ((metavar: string) => Message);
}

/**
 * Creates a parser that expects a single argument value.
 * This parser is typically used for positional arguments
 * that are not options or flags.
 * @template M The execution mode of the parser.
 * @template T The type of the value produced by the parser.
 * @param valueParser The {@link ValueParser} that defines how to parse
 *                    the argument value.
 * @param options Optional configuration for the argument parser,
 *                allowing you to specify a description or other metadata.
 * @returns A {@link Parser} that expects a single argument value and produces
 *          the parsed value of type {@link T}.
 */
export function argument<M extends Mode, T>(
  valueParser: ValueParser<M, T>,
  options: ArgumentOptions = {},
): Parser<M, T, ValueParserResult<T> | undefined> {
  const isAsync = valueParser.mode === "async";
  const syncValueParser = valueParser as ValueParser<"sync", T>;
  const dependencyMetadata = extractDependencyMetadata(valueParser);
  // Shared error formatter used by both complete() and validateValue()
  // so that fallback validation errors from bindEnv() / bindConfig()
  // carry the same metavar prefix and `options.errors.invalidValue`
  // customization as CLI-sourced errors (see issue #414).
  const formatInvalidValueError = (error: Message): Message =>
    options.errors?.invalidValue
      ? (typeof options.errors.invalidValue === "function"
        ? options.errors.invalidValue(error)
        : options.errors.invalidValue)
      : message`${metavar(valueParser.metavar)}: ${error}`;

  const optionPattern = /^--?[a-z0-9-]+$/i;
  const term: UsageTerm = {
    type: "argument",
    metavar: valueParser.metavar,
    ...(options.hidden != null && { hidden: options.hidden }),
  };
  // Use type assertion to allow both sync and async returns from parse method
  const result = {
    mode: valueParser.mode,
    $valueType: [],
    $stateType: [],
    priority: 5,
    usage: [term],
    leadingNames: EMPTY_LEADING_NAMES,
    acceptingAnyToken: true,
    initialState: undefined,
    parse(
      context: ParserContext<
        ValueParserResult<T> | undefined
      >,
    ) {
      const localState = normalizeInjectedAnnotationState(context.state);
      if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: options.errors?.endOfInput ??
            message`Expected an argument, but got end of input.`,
        };
      }

      let i = 0;
      let optionsTerminated = context.optionsTerminated;
      if (
        !optionsTerminated
      ) {
        if (context.buffer[i] === "--") {
          optionsTerminated = true;
          i++;
        } else if (context.buffer[i].match(optionPattern)) {
          return {
            success: false,
            consumed: i,
            error: message`Expected an argument, but got an option: ${
              eOptionName(context.buffer[i])
            }.`,
          };
        }
      }

      if (context.buffer.length < i + 1) {
        return {
          success: false,
          consumed: i,
          error: message`Expected an argument, but got end of input.`,
        };
      }

      if (localState != null) {
        return {
          success: false,
          consumed: i,
          error: options.errors?.multiple
            ? (typeof options.errors.multiple === "function"
              ? options.errors.multiple(valueParser.metavar)
              : options.errors.multiple)
            : message`The argument ${
              metavar(valueParser.metavar)
            } cannot be used multiple times.`,
        };
      }

      const rawInput = context.buffer[i];
      return dispatchByMode(
        valueParser.mode,
        () => {
          const parseResult = syncValueParser.parse(rawInput);
          const next = recordTrace(
            context,
            buildTraceEntry(
              "argument-value",
              rawInput,
              context.buffer.slice(0, i + 1),
              syncValueParser,
              parseResult,
            ),
          );
          return {
            success: true as const,
            next: {
              ...next,
              buffer: context.buffer.slice(i + 1),
              state: createOptionParseState(parseResult),
              optionsTerminated,
            },
            consumed: context.buffer.slice(0, i + 1),
          };
        },
        async () => {
          const parseResult = await valueParser.parse(rawInput);
          const next = recordTrace(
            context,
            buildTraceEntry(
              "argument-value",
              rawInput,
              context.buffer.slice(0, i + 1),
              valueParser,
              parseResult,
            ),
          );
          return {
            success: true as const,
            next: {
              ...next,
              buffer: context.buffer.slice(i + 1),
              state: createOptionParseState(parseResult),
              optionsTerminated,
            },
            consumed: context.buffer.slice(0, i + 1),
          };
        },
      );
    },
    complete(
      state: ValueParserResult<T> | undefined,
      exec?: ExecutionContext,
    ): ModeValue<M, ValueParserResult<T>> {
      const missing = {
        success: false as const,
        error: options.errors?.endOfInput ??
          message`Expected a ${
            metavar(valueParser.metavar)
          }, but too few arguments.`,
      };
      const completeSync = (): ValueParserResult<T> => {
        if (state == null) return missing;
        const resolvedState = dependencyMetadata?.derived != null
          ? resolveDerivedCompletionSync(dependencyMetadata, state, exec)
          : state;
        return resolvedState.success ? resolvedState : {
          success: false,
          error: formatInvalidValueError(resolvedState.error),
        };
      };
      const completeAsync = async (): Promise<ValueParserResult<T>> => {
        if (state == null) return missing;
        if (dependencyMetadata?.derived == null) return completeSync();
        const resolved = await resolveDerivedCompletionAsync(
          dependencyMetadata,
          state,
          exec,
        );
        return resolved.success ? resolved : {
          success: false,
          error: formatInvalidValueError(resolved.error),
        };
      };
      return dispatchByMode(
        valueParser.mode,
        completeSync,
        completeAsync,
      );
    },
    suggest(
      context: ParserContext<
        ValueParserResult<T> | undefined
      >,
      prefix: string,
    ) {
      if (normalizeInjectedAnnotationState(context.state) != null) {
        return dispatchIterableByMode<M, Suggestion>(
          valueParser.mode,
          function* () {},
          async function* () {},
        );
      }
      // For async parsers, use async generator; for sync parsers, use sync generator
      if (isAsync) {
        return suggestArgumentAsync(
          valueParser,
          isSuggestionHidden(options.hidden),
          prefix,
          context.dependencyRegistry,
          context.exec,
        );
      }
      return suggestArgumentSync(
        valueParser as ValueParser<"sync", T>,
        isSuggestionHidden(options.hidden),
        prefix,
        context.dependencyRegistry,
        context.exec,
      );
    },
    getDocFragments(
      _state: DocState<ValueParserResult<T> | undefined>,
      defaultValue?: T,
    ) {
      if (isDocHidden(options.hidden)) {
        return { fragments: [], description: options.description };
      }
      const choicesMessage: Message | undefined =
        valueParser.choices != null && valueParser.choices.length > 0
          ? valueSet(
            valueParser.choices.map((c) => valueParser.format(c)),
            { fallback: "", type: "unit" },
          )
          : undefined;
      const fragments: readonly DocFragment[] = [{
        type: "entry",
        term,
        description: options.description,
        default: defaultValue == null
          ? undefined
          : message`${valueParser.format(defaultValue)}`,
        choices: choicesMessage,
      }];
      return { fragments, description: options.description };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `argument()`;
    },
  };
  // Define normalizeValue as non-enumerable so that ...parser spread in
  // map() does not propagate the inner normalizer to the mapped type.
  if (typeof valueParser.normalize === "function") {
    const normalize = valueParser.normalize.bind(valueParser);
    Object.defineProperty(result, "normalizeValue", {
      value(v: T): T {
        try {
          return normalize(v);
        } catch {
          return v;
        }
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Define validateValue as non-enumerable so that ...parser spread in
  // map() does not propagate it to the mapped type (see issue #414).
  // Re-validates a value as if it had been parsed from CLI input by
  // round-tripping through ValueParser.format() + ValueParser.parse().
  //
  // Derived value parsers (`deriveFrom`) are exempt: their `format()`
  // rebuilds the parser from *default* dependency values rather than
  // the live ones resolved at parse time, so a format+parse round-trip
  // would validate against the wrong branch.  For those parsers we
  // skip attaching validateValue entirely.
  if (!isDerivedValueParser(valueParser)) {
    const vp = valueParser;
    const vpMode = valueParser.mode;
    // Wraps a ValueParser.parse() failure with the same metavar-scoped
    // error formatting that `complete()` applies to CLI-sourced errors,
    // so fallback validation failures look identical to CLI failures.
    const wrapParseResult = (
      parsed: ValueParserResult<T>,
    ): ValueParserResult<T> =>
      parsed.success
        ? parsed
        : { success: false, error: formatInvalidValueError(parsed.error) };
    Object.defineProperty(result, "validateValue", {
      value(v: T): ModeValue<M, ValueParserResult<T>> {
        let stringified: string;
        try {
          stringified = vp.format(v);
        } catch {
          // format() may throw for sentinel defaults whose type cannot
          // be serialized by this value parser.  Skip validation and
          // return success unchanged so sentinel-default users are
          // not broken.
          return wrapForMode<M, ValueParserResult<T>>(vpMode, {
            success: true as const,
            value: v,
          });
        }
        if (typeof stringified !== "string") {
          return wrapForMode<M, ValueParserResult<T>>(vpMode, {
            success: true as const,
            value: v,
          });
        }
        return dispatchByMode<M, ValueParserResult<T>>(
          vpMode,
          () => wrapParseResult(syncValueParser.parse(stringified)),
          async () => wrapParseResult(await vp.parse(stringified)),
        );
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Define placeholder lazily to avoid triggering derived value parser
  // factory functions during parser construction.  Non-enumerable so that
  // ...parser spread in map() does not eagerly evaluate the getter.
  Object.defineProperty(result, "placeholder", {
    get() {
      try {
        return valueParser.placeholder;
      } catch {
        return undefined;
      }
    },
    configurable: true,
    enumerable: false,
  });
  if (dependencyMetadata != null) {
    Object.defineProperty(result, "dependencyMetadata", {
      value: dependencyMetadata,
      configurable: true,
      enumerable: false,
    });
  }
  // Type assertion via 'unknown' needed because TypeScript's conditional type
  // ModeValue<M, T> cannot be verified when M is a generic type parameter.
  return result as unknown as Parser<M, T, ValueParserResult<T> | undefined>;
}

/**
 * Options for the {@link command} parser.
 * @since 0.5.0
 */
export interface CommandOptions {
  /**
   * A brief description of the command, shown in command lists.
   * If provided along with {@link description}, this will be used in
   * command listings (e.g., `myapp help`), while {@link description}
   * will be used for detailed help (e.g., `myapp help subcommand` or
   * `myapp subcommand --help`).
   * @since 0.6.0
   */
  readonly brief?: Message;

  /**
   * A description of the command, used for documentation.
   */
  readonly description?: Message;

  /**
   * A footer message that appears at the bottom of the command's help text.
   * Useful for showing examples, notes, or additional information.
   * @since 0.6.0
   */
  readonly footer?: Message;

  /**
   * Usage line override for this command's own help page.
   *
   * This option customizes the usage tail shown when rendering help for this
   * command itself (e.g., `myapp config --help`). It does not change parsing
   * behavior or shell completion.
   *
   * - `Usage`: Replaces the default usage tail.
   * - `(defaultUsageLine) => Usage`: Computes the usage tail from the default.
   *
   * @since 1.0.0
   */
  readonly usageLine?: Usage | ((defaultUsageLine: Usage) => Usage);

  /**
   * Controls command visibility:
   *
   * - `true`: hide from usage, docs, and suggestions
   * - `"usage"`: hide from usage only
   * - `"doc"`: hide from docs only
   * - `"help"`: hide from usage and docs, keep suggestions
   *
   * @since 0.9.0
   */
  readonly hidden?: HiddenVisibility;

  /**
   * Error messages customization.
   * @since 0.5.0
   */
  readonly errors?: CommandErrorOptions;
}

/**
 * Options for customizing error messages in the {@link command} parser.
 * @since 0.5.0
 */
export interface CommandErrorOptions {
  /**
   * Error message when command is expected but not found.
   * Since version 0.7.0, the function signature now includes suggestions:
   * - expected: The expected command name
   * - actual: The actual input (or null if no input)
   * - suggestions: Array of similar valid command names (can be empty)
   */
  readonly notMatched?:
    | Message
    | ((
      expected: string,
      actual: string | null,
      suggestions?: readonly string[],
    ) => Message);

  /**
   * Error message when command was not matched during completion.
   */
  readonly notFound?: Message;

  /**
   * Error message for invalid command state.
   */
  readonly invalidState?: Message;
}

/**
 * The state type for the {@link command} parser.
 * @template TState The type of the inner parser's state.
 */
type CommandState<TState> =
  | undefined // Command not yet matched
  | ["matched", string] // Command matched but inner parser not started
  | ["parsing", TState]; // Command matched and inner parser active

function normalizeCommandState<TState>(
  state: CommandState<TState>,
): CommandState<TState> {
  return normalizeInjectedAnnotationState(state);
}

function getCommandParseChildState<TState>(
  commandState: CommandState<TState>,
  childState: TState,
  parser: Parser<Mode, unknown, unknown>,
): TState {
  return getWrappedChildParseState(commandState, childState, parser);
}

function getCommandChildState<TState>(
  commandState: CommandState<TState>,
  childState: TState,
  parser: Parser<Mode, unknown, unknown>,
): TState {
  return getWrappedChildState(commandState, childState, parser);
}

function createCommandState<TState>(
  sourceState: unknown,
  state: Exclude<CommandState<TState>, undefined>,
): Exclude<CommandState<TState>, undefined> {
  return annotateFreshArray(
    sourceState,
    state as readonly unknown[],
  ) as Exclude<
    CommandState<TState>,
    undefined
  >;
}

function appendCommandPath(
  exec: ExecutionContext | undefined,
  name: string,
): ExecutionContext | undefined {
  if (exec == null) return undefined;
  return {
    ...exec,
    commandPath: [...(exec.commandPath ?? []), name],
  };
}

function* suggestCommandSync<T, TState>(
  context: ParserContext<CommandState<TState>>,
  prefix: string,
  name: string,
  parser: Parser<"sync", T, TState>,
  options: CommandOptions,
): Generator<Suggestion> {
  if (isSuggestionHidden(options.hidden)) {
    return;
  }

  const state = normalizeCommandState(context.state);

  // Handle different command states
  if (state === undefined) {
    // Command not yet matched - suggest command name if it matches prefix
    if (name.startsWith(prefix)) {
      yield {
        kind: "literal",
        text: name,
        ...(options.description && { description: options.description }),
      };
    }
  } else if (state[0] === "matched") {
    // Command matched but inner parser not started - delegate to inner parser
    yield* parser.suggest(
      withChildContext(
        context,
        name,
        getCommandChildState(context.state, parser.initialState, parser),
        parser.usage,
      ),
      prefix,
    );
  } else if (state[0] === "parsing") {
    // Command in parsing state - delegate to inner parser
    yield* parser.suggest(
      withChildContext(
        context,
        name,
        getCommandChildState(context.state, state[1], parser),
        parser.usage,
      ),
      prefix,
    );
  }
}

async function* suggestCommandAsync<T, TState>(
  context: ParserContext<CommandState<TState>>,
  prefix: string,
  name: string,
  parser: Parser<Mode, T, TState>,
  options: CommandOptions,
): AsyncGenerator<Suggestion> {
  if (isSuggestionHidden(options.hidden)) {
    return;
  }

  const state = normalizeCommandState(context.state);

  // Handle different command states
  if (state === undefined) {
    // Command not yet matched - suggest command name if it matches prefix
    if (name.startsWith(prefix)) {
      yield {
        kind: "literal",
        text: name,
        ...(options.description && { description: options.description }),
      };
    }
  } else if (state[0] === "matched") {
    // Command matched but inner parser not started - delegate to inner parser
    const suggestions = parser.suggest(
      withChildContext(
        context,
        name,
        getCommandChildState(context.state, parser.initialState, parser),
        parser.usage,
      ),
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  } else if (state[0] === "parsing") {
    // Command in parsing state - delegate to inner parser
    const suggestions = parser.suggest(
      withChildContext(
        context,
        name,
        getCommandChildState(context.state, state[1], parser),
        parser.usage,
      ),
      prefix,
    ) as AsyncIterable<Suggestion>;
    for await (const s of suggestions) {
      yield s;
    }
  }
}

/**
 * Creates a parser that matches a specific subcommand name and then applies
 * an inner parser to the remaining arguments.
 * This is useful for building CLI tools with subcommands like git, npm, etc.
 * @template M The execution mode of the parser.
 * @template T The type of the value returned by the inner parser.
 * @template TState The type of the state used by the inner parser.
 * @param name The subcommand name to match (e.g., `"show"`, `"edit"`).
 * @param parser The {@link Parser} to apply after the command is matched.
 * @param options Optional configuration for the command parser, such as
 *                a description for documentation.
 * @returns A {@link Parser} that matches the command name and delegates
 *          to the inner parser for the remaining arguments.
 * @throws {TypeError} If `name` is empty, whitespace-only, contains
 *         embedded whitespace, or contains control characters.
 */
export function command<M extends Mode, T, TState>(
  name: string,
  parser: Parser<M, T, TState>,
  options: CommandOptions = {},
): Parser<M, T, CommandState<TState>> {
  validateCommandNames([name], "Command");
  const isAsync = parser.mode === "async";
  const syncInnerParser = parser as Parser<"sync", T, TState>;
  const asyncInnerParser = parser as Parser<"async", T, TState>;

  // Use type assertion to allow both sync and async returns from parse method
  const result = {
    [Symbol.for("@optique/core/commandParser")]: true,
    mode: parser.mode,
    $valueType: [],
    $stateType: [],
    priority: 15, // Higher than options to match commands first
    usage: [
      {
        type: "command",
        name,
        ...(options.usageLine != null && { usageLine: options.usageLine }),
        ...(options.hidden != null && { hidden: options.hidden }),
      },
      ...parser.usage,
    ],
    leadingNames: new Set([name]),
    acceptingAnyToken: false,
    initialState: undefined,
    getSuggestRuntimeNodes(
      state: CommandState<TState>,
      path: readonly PropertyKey[],
    ) {
      const normalizedState = normalizeCommandState(state);
      if (normalizedState === undefined) {
        return [];
      }
      const childState = normalizedState[0] === "matched"
        ? getCommandChildState(state, parser.initialState, parser)
        : getCommandChildState(state, normalizedState[1], parser);
      const childPath = [...path, name];
      return parser.getSuggestRuntimeNodes?.(childState, childPath) ??
        (parser.dependencyMetadata?.source != null
          ? [{ path: childPath, parser, state: childState }]
          : []);
    },
    parse(context: ParserContext<CommandState<TState>>) {
      const state = normalizeCommandState(context.state);
      // Handle different states
      if (state === undefined) {
        // Check if buffer starts with our command name
        if (context.buffer.length < 1 || context.buffer[0] !== name) {
          const actual = context.buffer.length > 0 ? context.buffer[0] : null;

          // Only suggest commands that are valid at the current parse position
          // (i.e., leading candidates), not sub-commands nested inside other
          // commands that the user has not yet entered.
          // See: https://github.com/dahlia/optique/issues/117
          const leadingCmds = extractLeadingCommandNames(context.usage);
          const suggestions = actual
            ? findSimilar(actual, leadingCmds, DEFAULT_FIND_SIMILAR_OPTIONS)
            : [];

          // If custom error is provided, use it
          if (options.errors?.notMatched) {
            const errorMessage = options.errors.notMatched;
            return {
              success: false,
              consumed: 0,
              error: typeof errorMessage === "function"
                ? errorMessage(name, actual, suggestions)
                : errorMessage,
            };
          }

          // Generate default error with suggestions
          if (actual == null) {
            return {
              success: false,
              consumed: 0,
              error: message`Expected command ${
                eOptionName(name)
              }, but got end of input.`,
            };
          }

          // Find similar command names
          const baseError = message`Expected command ${
            eOptionName(name)
          }, but got ${actual}.`;

          const suggestionMsg = createSuggestionMessage(suggestions);
          return {
            success: false,
            consumed: 0,
            error: suggestionMsg.length > 0
              ? [...baseError, text("\n\n"), ...suggestionMsg]
              : baseError,
          };
        }
        // Command matched, consume it and move to "matched" state
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: createCommandState(
              context.state,
              ["matched", name] as ["matched", string],
            ),
            ...(context.exec != null
              ? {
                exec: appendCommandPath(context.exec, name),
              }
              : {}),
          },
          consumed: context.buffer.slice(0, 1),
        };
      } else if (
        state[0] === "matched" ||
        state[0] === "parsing"
      ) {
        // "matched": command was matched, start the inner parser
        // "parsing": delegate to inner parser with existing state
        const innerState = state[0] === "matched"
          ? getCommandParseChildState(
            context.state,
            parser.initialState,
            parser,
          )
          : getCommandParseChildState(context.state, state[1], parser);

        const wrapState = (
          parseResult: ParserResult<TState>,
        ) => {
          if (parseResult.success) {
            const mergedExec = mergeChildExec(
              context.exec,
              parseResult.next.exec,
            );
            return {
              success: true as const,
              next: {
                ...parseResult.next,
                state: createCommandState(
                  context.state,
                  ["parsing", parseResult.next.state] as [
                    "parsing",
                    TState,
                  ],
                ),
                ...(mergedExec != null
                  ? {
                    exec: mergedExec,
                    dependencyRegistry: mergedExec.dependencyRegistry,
                  }
                  : {}),
              },
              consumed: parseResult.consumed,
            };
          }
          return parseResult;
        };

        return dispatchByMode(
          parser.mode,
          () =>
            wrapState(
              syncInnerParser.parse(
                withChildContext(context, name, innerState, parser.usage),
              ),
            ),
          async () =>
            wrapState(
              await parser.parse(
                withChildContext(context, name, innerState, parser.usage),
              ),
            ),
        );
      }
      // Should never reach here
      return {
        success: false,
        consumed: 0,
        error: options.errors?.invalidState ?? message`Invalid command state.`,
      };
    },
    complete(state: CommandState<TState>, exec?: ExecutionContext) {
      const normalizedState = normalizeCommandState(state);
      if (typeof normalizedState === "undefined") {
        return {
          success: false,
          error: options.errors?.notFound ??
            message`Command ${eOptionName(name)} was not matched.`,
        };
      } else if (normalizedState[0] === "matched") {
        // Command matched but inner parser never started.
        // First give the inner parser a chance to run with empty buffer,
        // then complete with the resulting state.
        const childExec = withChildExecPath(exec, name);
        const childContext = {
          buffer: [],
          optionsTerminated: false,
          usage: parser.usage,
          state: getCommandParseChildState(state, parser.initialState, parser),
          ...(childExec != null
            ? {
              exec: childExec,
              trace: childExec.trace,
              dependencyRegistry: childExec.dependencyRegistry,
            }
            : {}),
        };
        return dispatchByMode(
          parser.mode,
          () => {
            const parseResult = syncInnerParser.parse(childContext);
            const nextExec = parseResult.success
              ? mergeChildExec(childExec, parseResult.next.exec)
              : childExec;
            return syncInnerParser.complete(
              parseResult.success
                ? getCommandChildState(state, parseResult.next.state, parser)
                : getCommandChildState(
                  state,
                  syncInnerParser.initialState,
                  parser,
                ),
              nextExec,
            );
          },
          async () => {
            const parseResult = await asyncInnerParser.parse(childContext);
            const nextExec = parseResult.success
              ? mergeChildExec(childExec, parseResult.next.exec)
              : childExec;
            return asyncInnerParser.complete(
              parseResult.success
                ? getCommandChildState(state, parseResult.next.state, parser)
                : getCommandChildState(state, parser.initialState, parser),
              nextExec,
            );
          },
        );
      } else if (normalizedState[0] === "parsing") {
        // Delegate to inner parser
        const childExec = withChildExecPath(exec, name);
        return dispatchByMode(
          parser.mode,
          () =>
            syncInnerParser.complete(
              getCommandChildState(state, normalizedState[1], parser),
              childExec,
            ),
          async () =>
            await asyncInnerParser.complete(
              getCommandChildState(state, normalizedState[1], parser),
              childExec,
            ),
        );
      }
      // Should never reach here
      return {
        success: false,
        error: options.errors?.invalidState ??
          message`Invalid command state during completion.`,
      };
    },
    [extractPhase2SeedKey](
      state: CommandState<TState>,
      exec?: ExecutionContext,
    ) {
      const normalizedState = normalizeCommandState(state);
      if (typeof normalizedState === "undefined") {
        return wrapForMode(parser.mode, null);
      }
      if (normalizedState[0] === "matched") {
        const childExec = withChildExecPath(exec, name);
        const childContext = {
          buffer: [],
          optionsTerminated: false,
          usage: parser.usage,
          state: getCommandParseChildState(state, parser.initialState, parser),
          ...(childExec != null
            ? {
              exec: childExec,
              trace: childExec.trace,
              dependencyRegistry: childExec.dependencyRegistry,
            }
            : {}),
        };
        return dispatchByMode(
          parser.mode,
          () => {
            const parseResult = syncInnerParser.parse(childContext);
            const nextExec = parseResult.success
              ? mergeChildExec(childExec, parseResult.next.exec)
              : childExec;
            return completeOrExtractPhase2Seed(
              syncInnerParser,
              parseResult.success
                ? getCommandChildState(state, parseResult.next.state, parser)
                : getCommandChildState(
                  state,
                  syncInnerParser.initialState,
                  parser,
                ),
              nextExec,
            );
          },
          async () => {
            const parseResult = await asyncInnerParser.parse(childContext);
            const nextExec = parseResult.success
              ? mergeChildExec(childExec, parseResult.next.exec)
              : childExec;
            return await completeOrExtractPhase2Seed(
              asyncInnerParser,
              parseResult.success
                ? getCommandChildState(state, parseResult.next.state, parser)
                : getCommandChildState(state, parser.initialState, parser),
              nextExec,
            );
          },
        );
      }
      if (normalizedState[0] === "parsing") {
        return completeOrExtractPhase2Seed(
          parser,
          getCommandChildState(state, normalizedState[1], parser),
          withChildExecPath(exec, name),
        );
      }
      return wrapForMode(parser.mode, null);
    },
    suggest(
      context: ParserContext<CommandState<TState>>,
      prefix: string,
    ) {
      if (isAsync) {
        return suggestCommandAsync(
          context,
          prefix,
          name,
          parser,
          options,
        );
      }
      return suggestCommandSync(
        context,
        prefix,
        name,
        parser as Parser<"sync", T, TState>,
        options,
      );
    },
    getDocFragments(state: DocState<CommandState<TState>>, defaultValue?: T) {
      const commandState = state.kind === "available"
        ? normalizeCommandState(state.state)
        : undefined;
      if (state.kind === "unavailable" || typeof commandState === "undefined") {
        // When the command is not matched (showing in a list), apply hidden option
        if (isDocHidden(options.hidden)) {
          return { fragments: [], description: options.description };
        }
        // When showing command in a list, use brief if available,
        // otherwise fall back to description
        return {
          description: options.description,
          fragments: [
            {
              type: "entry",
              term: { type: "command", name },
              description: options.brief ?? options.description,
            },
          ],
        };
      }
      // When the command is matched and executing, show inner parser documentation
      // regardless of hidden status
      const innerState: DocState<TState> = commandState[0] === "parsing"
        ? {
          kind: "available",
          state: getCommandChildState(state.state, commandState[1], parser),
        }
        : {
          kind: "available",
          state: getCommandChildState(
            state.state,
            parser.initialState,
            parser,
          ),
        };
      const innerFragments = parser.getDocFragments(
        innerState,
        defaultValue,
      );
      // When the command is matched and we are rendering its *own* help page,
      // `brief` appears at the very top (before Usage) and `description`
      // appears below the Usage line.  Inner parsers' values take precedence
      // via the spread; this command's own values fill in any gaps.
      return {
        ...innerFragments,
        brief: innerFragments.brief ?? options.brief,
        description: innerFragments.description ?? options.description,
        footer: innerFragments.footer ?? options.footer,
      };
    },
    [Symbol.for("Deno.customInspect")]() {
      return `command(${JSON.stringify(name)})`;
    },
  };
  // Forward value normalization as non-enumerable so that withDefault()
  // can normalize defaults through command() wrappers.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(result, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  // Forward fallback validation as non-enumerable (see issue #414).
  // command() is a transparent wrapper over its inner parser, so when
  // a command's result has a validateValue hook it is delegated as-is.
  if (typeof parser.validateValue === "function") {
    Object.defineProperty(result, "validateValue", {
      value: parser.validateValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  // Type assertion via 'unknown' needed because TypeScript's conditional type
  // ModeValue<M, T> cannot be verified when M is a generic type parameter.
  return result as unknown as Parser<M, T, CommandState<TState>>;
}

/**
 * Format options for how {@link passThrough} captures options.
 * @since 0.8.0
 */
export type PassThroughFormat = "equalsOnly" | "nextToken" | "greedy";

/**
 * Options for the {@link passThrough} parser.
 * @since 0.8.0
 */
export interface PassThroughOptions {
  /**
   * How to capture option values:
   *
   * - `"equalsOnly"`: Only capture `--opt=val` format (default, safest).
   *   Values with spaces (`--opt val`) are not captured.
   *
   * - `"nextToken"`: Capture `--opt` and its value as separate tokens
   *   (`--opt val`). The next token is captured if it doesn't start with `-`.
   *
   * - `"greedy"`: Capture *all* remaining tokens from first unrecognized token.
   *   This is useful for wrapper/proxy tools that pass everything through.
   *
   * @default `"equalsOnly"`
   */
  readonly format?: PassThroughFormat;

  /**
   * A description of what pass-through options are used for.
   */
  readonly description?: Message;

  /**
   * Controls pass-through visibility:
   *
   * - `true`: hide from usage, docs, and suggestions
   * - `"usage"`: hide from usage only
   * - `"doc"`: hide from docs only
   * - `"help"`: hide from usage and docs, keep suggestions
   *
   * @since 0.9.0
   */
  readonly hidden?: HiddenVisibility;
}

/**
 * Creates a parser that collects unrecognized options and passes them through.
 * This is useful for building wrapper CLI tools that need to forward unknown
 * options to an underlying tool.
 *
 * **Important**: This parser intentionally weakens Optique's strict parsing
 * philosophy where "all input must be recognized." The benefit is enabling
 * legitimate wrapper/proxy tool patterns, but the trade-off is that typos
 * in pass-through options won't be caught.
 *
 * @param options Configuration for how to capture options.
 * @returns A {@link Parser} that captures unrecognized options as an array
 *          of strings.
 *
 * @example
 * ```typescript
 * // Default format: only captures --opt=val
 * const parser = object({
 *   debug: option("--debug"),
 *   extra: passThrough(),
 * });
 *
 * // mycli --debug --foo=bar --baz=qux
 * // → { debug: true, extra: ["--foo=bar", "--baz=qux"] }
 *
 * // nextToken format: captures --opt val pairs
 * const parser = object({
 *   debug: option("--debug"),
 *   extra: passThrough({ format: "nextToken" }),
 * });
 *
 * // mycli --debug --foo bar
 * // → { debug: true, extra: ["--foo", "bar"] }
 *
 * // greedy format: captures all remaining tokens
 * const parser = command("exec", object({
 *   container: argument(string()),
 *   args: passThrough({ format: "greedy" }),
 * }));
 *
 * // myproxy exec mycontainer --verbose -it bash
 * // → { container: "mycontainer", args: ["--verbose", "-it", "bash"] }
 * ```
 *
 * @since 0.8.0
 */
export function passThrough(
  options: PassThroughOptions = {},
): Parser<"sync", readonly string[], readonly string[]> {
  const format = options.format ?? "equalsOnly";
  const optionPattern = /^-[a-z0-9-]|^--[a-z0-9-]+/i;
  const equalsOptionPattern = /^--[a-z0-9-]+=/i;

  return {
    $valueType: [],
    $stateType: [],
    mode: "sync",
    priority: -10, // Lowest priority to be tried last
    usage: [{
      type: "passthrough",
      ...(options.hidden != null && { hidden: options.hidden }),
    }],
    leadingNames: EMPTY_LEADING_NAMES,
    acceptingAnyToken: false,
    initialState: [],

    parse(context) {
      if (context.buffer.length < 1) {
        return {
          success: false,
          consumed: 0,
          error: message`No input to pass through.`,
        };
      }

      const token = context.buffer[0];

      if (format === "greedy") {
        // Greedy mode: capture ALL remaining tokens
        const captured = [...context.buffer];
        return {
          success: true,
          next: {
            ...context,
            buffer: [],
            state: annotateFreshArray(context.state, [
              ...context.state,
              ...captured,
            ]),
          },
          consumed: captured,
        };
      }

      // For equalsOnly and nextToken, don't capture after options terminator
      if (context.optionsTerminated) {
        return {
          success: false,
          consumed: 0,
          error:
            message`Options terminated; cannot capture pass-through options.`,
        };
      }

      if (format === "equalsOnly") {
        // Only capture --opt=val format
        if (!equalsOptionPattern.test(token)) {
          return {
            success: false,
            consumed: 0,
            error: message`Expected --option=value format, but got: ${token}.`,
          };
        }

        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: annotateFreshArray(context.state, [...context.state, token]),
          },
          consumed: [token],
        };
      }

      if (format === "nextToken") {
        // Must start with an option-like token
        if (!optionPattern.test(token)) {
          return {
            success: false,
            consumed: 0,
            error: message`Expected option, but got: ${token}.`,
          };
        }

        // Check for --opt=val format (already includes value)
        if (token.includes("=")) {
          return {
            success: true,
            next: {
              ...context,
              buffer: context.buffer.slice(1),
              state: annotateFreshArray(context.state, [
                ...context.state,
                token,
              ]),
            },
            consumed: [token],
          };
        }

        // Check if next token is a value (doesn't start with -)
        const nextToken = context.buffer[1];
        if (nextToken !== undefined && !optionPattern.test(nextToken)) {
          // Capture both the option and its value
          return {
            success: true,
            next: {
              ...context,
              buffer: context.buffer.slice(2),
              state: annotateFreshArray(context.state, [
                ...context.state,
                token,
                nextToken,
              ]),
            },
            consumed: [token, nextToken],
          };
        }

        // No value follows, just capture the option
        return {
          success: true,
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: annotateFreshArray(context.state, [...context.state, token]),
          },
          consumed: [token],
        };
      }

      // Should never reach here
      return {
        success: false,
        consumed: 0,
        error: message`Unknown passThrough format: ${format}.`,
      };
    },

    complete(state, _exec?: ExecutionContext) {
      if (getAnnotations(state) == null) {
        return { success: true, value: state };
      }
      const copied: readonly string[] = [...state];
      return { success: true, value: copied };
    },

    suggest(_context, _prefix) {
      // passThrough cannot suggest specific values since it captures unknown options
      return [];
    },

    getDocFragments(_state, _defaultValue?) {
      if (isDocHidden(options.hidden)) {
        return { fragments: [], description: options.description };
      }
      return {
        fragments: [{
          type: "entry",
          term: { type: "passthrough" },
          description: options.description,
        }],
        description: options.description,
      };
    },

    [Symbol.for("Deno.customInspect")]() {
      return `passThrough(${format})`;
    },
  };
}
