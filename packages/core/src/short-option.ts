import { inheritAnnotations } from "./internal/annotations.ts";
import type { Mode, Parser, ParserContext, Suggestion } from "./parser.ts";
import { extractOptionNames } from "./usage.ts";
import {
  collectOptionNamesAtCurrentCommandDepth,
  type CurrentOptionNames,
} from "./usage-internals.ts";

const optionScopeKey: unique symbol = Symbol("optionScope");
const scopeSourceKey: unique symbol = Symbol("optionScopeSource");
type ScopeSource = (
  selections: ReadonlyMap<ScopeSource, ScopeSource>,
  arities?: CurrentOptionNames,
  context?: ParserContext<unknown>,
) => ReadonlySet<string>;
interface ScopedContext {
  readonly [optionScopeKey]?: {
    readonly names: ReadonlySet<string>;
    readonly sources: ReadonlySet<ScopeSource>;
    readonly selections: Map<ScopeSource, ScopeSource>;
  };
}
interface ScopedParser {
  readonly [scopeSourceKey]?: ScopeSource;
}
const primitiveScopes = new WeakMap<object, ScopeSource>();
function parserScope(parser: Parser<Mode, unknown, unknown>): ScopeSource {
  const declared = (parser as ScopedParser)[scopeSourceKey];
  if (declared != null) return declared;
  let source = primitiveScopes.get(parser);
  if (source == null) {
    source = (_selections, arities) => {
      if (arities != null) {
        collectOptionNamesAtCurrentCommandDepth(parser.usage, arities, false);
      }
      return parser.leadingNames;
    };
    primitiveScopes.set(parser, source);
  }
  return source;
}

/** Combines declarations without flattening conditional ownership. @internal */
export function combinedOptionScope(
  parsers: readonly Parser<Mode, unknown, unknown>[],
): ScopeSource {
  return (selections, arities, context) =>
    new Set(
      parsers.flatMap((
        parser,
      ) => [...parserScope(parser)(selections, arities, context)]),
    );
}

/** Tracks declarations after a command or discriminator routes input. @internal */
export function selectableOptionScope(initial: ScopeSource) {
  const source: ScopeSource = (selections, arities, context) =>
    (selections.get(source) ?? initial)(selections, arities, context);
  return {
    source,
    select(context: ParserContext<unknown>, selected: ScopeSource): void {
      (context as ScopedContext)[optionScopeKey]?.selections.set(
        source,
        selected,
      );
    },
  };
}

/** Keeps selected conditional names distinct from sibling declarations. @internal */
export function conditionalOptionScope(
  discriminator: Parser<Mode, unknown, unknown>,
  fallback?: Parser<Mode, unknown, unknown>,
  candidates: readonly Parser<Mode, unknown, unknown>[] = [],
) {
  const scope = selectableOptionScope((selections, arities, context) => {
    const canSkip = discriminator.canSkip?.(
      context == null
        ? discriminator.initialState
        : inheritAnnotations(context.state, discriminator.initialState),
      context?.exec,
    ) === true;
    return combinedOptionScope([
      discriminator,
      ...(canSkip ? candidates : []),
      ...(fallback == null ? [] : [fallback]),
    ])(selections, arities, context);
  });
  return {
    source: scope.source,
    select(
      context: ParserContext<unknown>,
      branch: Parser<Mode, unknown, unknown>,
    ): void {
      scope.select(context, combinedOptionScope([discriminator, branch]));
    },
  };
}

/** Returns the names reachable in this parse scope. @internal */
export function getOptionScope(
  context: ParserContext<unknown>,
): ReadonlySet<string> {
  const scoped = (context as ScopedContext)[optionScopeKey];
  const names = scoped == null
    ? extractOptionNames(context.usage, true)
    : new Set([
      ...scoped.names,
      ...[...scoped.sources].flatMap((
        source,
      ) => [...source(scoped.selections, undefined, context)]),
    ]);
  return names;
}

/** Adds reachable names without consulting the flattened help tree. @internal */
export function withOptionScope<S>(
  context: ParserContext<S>,
  names: ReadonlySet<string>,
): ParserContext<S> & ScopedContext {
  const inherited = (context as ScopedContext)[optionScopeKey];
  return {
    ...context,
    [optionScopeKey]: {
      names: new Set([...(inherited?.names ?? []), ...names]),
      sources: inherited?.sources ?? new Set(),
      selections: inherited?.selections ?? new Map(),
    },
  };
}

/** Adds a parser's owned declarations, retaining modifier metadata. @internal */
export function withParserOptionScope<S>(
  context: ParserContext<S>,
  parser: Parser<Mode, unknown, unknown>,
): ParserContext<S> & ScopedContext {
  const inherited = (context as ScopedContext)[optionScopeKey];
  return {
    ...context,
    [optionScopeKey]: {
      names: inherited?.names ?? new Set(),
      sources: new Set([...(inherited?.sources ?? []), parserScope(parser)]),
      selections: inherited?.selections ?? new Map(),
    },
  };
}

/** Isolates route selections while probing a competing branch. @internal */
export function forkOptionScope<S>(
  context: ParserContext<S>,
): ParserContext<S> & ScopedContext {
  const scoped = (context as ScopedContext)[optionScopeKey];
  return scoped == null ? context : {
    ...context,
    [optionScopeKey]: {
      ...scoped,
      selections: new Map(scoped.selections),
    },
  };
}

/** Publishes winning routes without persisting temporary candidate names. @internal */
export function adoptOptionScope<S>(
  context: ParserContext<S>,
  next: ParserContext<unknown>,
): ParserContext<S> {
  const own = (context as ScopedContext)[optionScopeKey];
  const child = (next as ScopedContext)[optionScopeKey];
  if (own != null && child != null) {
    for (const [source, selected] of child.selections) {
      own.selections.set(source, selected);
    }
  }
  return context;
}

/** Removes names reserved only for a speculative probe. @internal */
export function restoreOptionScope<S>(
  next: ParserContext<S>,
  parent: ParserContext<unknown>,
): ParserContext<S> & ScopedContext {
  adoptOptionScope(parent, next);
  const own = (parent as ScopedContext)[optionScopeKey];
  const child = (next as ScopedContext)[optionScopeKey];
  return own == null || child == null ? next : {
    ...next,
    [optionScopeKey]: {
      ...child,
      names: own.names,
      selections: own.selections,
    },
  };
}

/** Decorates construct entry points while retaining internal metadata. @internal */
export function scopeParser<M extends Mode, T, S>(
  parser: Parser<M, T, S>,
  source: ScopeSource = () => parser.leadingNames,
  prepare?: (context: ParserContext<S>) => void,
): Parser<M, T, S> {
  const parse = parser.parse;
  const suggest = parser.suggest;
  Object.defineProperties(parser, {
    [scopeSourceKey]: { value: source, enumerable: true },
    parse: {
      enumerable: true,
      configurable: true,
      writable: true,
      value: (context: ParserContext<S>) => {
        const scoped = withParserOptionScope(context, parser);
        prepare?.(scoped);
        return parse.call(parser, scoped);
      },
    },
    suggest: {
      enumerable: true,
      configurable: true,
      writable: true,
      value: (context: ParserContext<S>, prefix: string) => {
        const scoped = withParserOptionScope(context, parser);
        prepare?.(scoped);
        return suggest.call(parser, scoped, prefix);
      },
    },
  });
  return parser;
}

/** Tests full-name ownership before splitting a short prefix. @internal */
export function fullNameOwnsToken(
  context: ParserContext<unknown>,
  token: string,
): boolean {
  if (!/^-[^-]/.test(token)) return false;
  for (const name of getOptionScope(context)) {
    if (
      name.startsWith("-") && !name.startsWith("--") && name.length > 2 &&
      (token === name || token.startsWith(`${name}=`))
    ) return true;
  }
  return false;
}

/** Finds the value part of an attached short-option completion. @internal */
export function attachedValuePrefix(
  context: ParserContext<unknown>,
  prefix: string,
  optionNames: readonly string[],
): { readonly head: string; readonly value: string } | undefined {
  if (!/^-[^-]/.test(prefix)) return undefined;
  const scope = getOptionScope(context);
  const names = { value: new Set<string>(), flag: new Set<string>() };
  const scoped = (context as ScopedContext)[optionScopeKey];
  if (scoped == null) {
    collectOptionNamesAtCurrentCommandDepth(context.usage, names, false);
  } else {
    for (const source of scoped.sources) {
      source(scoped.selections, names, context);
    }
  }
  for (let index = 1; index < prefix.length; index++) {
    const remainder = `-${prefix.slice(index)}`;
    for (const name of scope) {
      if (
        name.startsWith("-") && !name.startsWith("--") && name.length > 2 &&
        (name.startsWith(remainder) || remainder.startsWith(`${name}=`))
      ) return undefined;
    }
    const short = `-${prefix[index]}`;
    if (optionNames.includes(short)) {
      return {
        head: prefix.slice(0, index + 1),
        value: prefix.slice(index + 1),
      };
    }
    if (!scope.has(short) || !names.flag.has(short) || names.value.has(short)) {
      return undefined;
    }
  }
  return undefined;
}

/** Preserves the prefix when embedding value suggestions in one token. @internal */
export function prefixSuggestion(
  head: string,
  suggestion: Suggestion,
): Suggestion {
  return {
    kind: "literal",
    text: head +
      (suggestion.kind === "literal"
        ? suggestion.text
        : suggestion.pattern ?? ""),
    ...(suggestion.description != null
      ? { description: suggestion.description }
      : {}),
  };
}
