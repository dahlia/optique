import { withChildExecPath } from "./execution-context.ts";
import { mapModeValue } from "./internal/mode-dispatch.ts";
import { inheritAnnotations } from "./internal/annotations.ts";
import type { Mode, Parser, ParserContext, Suggestion } from "./parser.ts";
import { extractOptionNames } from "./usage.ts";
import {
  collectOptionNamesAtCurrentCommandDepth,
  type CurrentOptionNames,
} from "./usage-internals.ts";

const optionScopeKey: unique symbol = Symbol("optionScope");
const optionPathKey: unique symbol = Symbol("optionScopePath");
const scopeSourceKey: unique symbol = Symbol("optionScopeSource");
type ScopeSource = (
  selections: ReadonlyMap<ScopeSource, ScopeSource>,
  arities?: CurrentOptionNames,
  context?: ParserContext<unknown>,
  path?: readonly PropertyKey[],
) => ReadonlySet<string>;
interface ScopedContext {
  readonly [optionPathKey]?: readonly PropertyKey[];
  readonly [optionScopeKey]?: {
    readonly names: ReadonlySet<string>;
    readonly sources: ReadonlySet<ScopeSource>;
    readonly selections: Map<ScopeSource, ScopeSource>;
  };
}
interface ScopedParser {
  readonly [scopeSourceKey]?: ScopeSource;
}
interface ScopeNode {
  readonly children: Map<PropertyKey, ScopeNode>;
  readonly bound: ScopeSource;
}
const scopeLocations = new WeakMap<ScopeSource, readonly PropertyKey[]>();
// Occurrence paths belong to one parse, including its speculative forks.
// Weak keys let discarded parse contexts release all numeric path bindings.
const scopeBindings = new WeakMap<
  ReadonlyMap<ScopeSource, ScopeSource>,
  WeakMap<ScopeSource, ScopeNode>
>();
function getScopeBindings(selections: ReadonlyMap<ScopeSource, ScopeSource>) {
  let bindings = scopeBindings.get(selections);
  if (bindings == null) {
    bindings = new WeakMap<ScopeSource, ScopeNode>();
    scopeBindings.set(selections, bindings);
  }
  return bindings;
}
function bindScope(
  source: ScopeSource,
  path: readonly PropertyKey[],
  selections: ReadonlyMap<ScopeSource, ScopeSource>,
): ScopeSource {
  const boundScopes = getScopeBindings(selections);
  let node = boundScopes.get(source);
  if (node == null) {
    node = {
      children: new Map(),
      bound: (selections, arities, context) =>
        source(selections, arities, context, []),
    };
    boundScopes.set(source, node);
    scopeLocations.set(node.bound, []);
  }
  for (let i = 0; i < path.length; i++) {
    let child: ScopeNode | undefined = node.children.get(path[i]);
    if (child == null) {
      const occurrence = path.slice(0, i + 1);
      child = {
        children: new Map(),
        bound: (selections, arities, context) =>
          source(selections, arities, context, occurrence),
      };
      node.children.set(path[i], child);
      scopeLocations.set(child.bound, occurrence);
    }
    node = child;
  }
  return node.bound;
}
function scopePath(context: ParserContext<unknown>): readonly PropertyKey[] {
  return context.exec?.path ?? (context as ScopedContext)[optionPathKey] ?? [];
}

/** Tracks child occurrences even for contexts without execution metadata. @internal */
export function withOptionScopeChild<S>(
  context: ParserContext<S>,
  segment: PropertyKey,
): ParserContext<S> & ScopedContext {
  return { ...context, [optionPathKey]: [...scopePath(context), segment] };
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
  segments?: readonly PropertyKey[],
): ScopeSource {
  return (selections, arities, context, path = []) =>
    new Set(
      parsers.flatMap((
        parser,
        index,
      ) => [
        ...parserScope(parser)(
          selections,
          arities,
          context,
          segments == null ? path : [...path, segments[index]],
        ),
      ]),
    );
}

/** Evaluates repeated declarations at their actual item occurrences. @internal */
export function repeatedOptionScope(
  parser: Parser<Mode, unknown, unknown>,
): ScopeSource {
  return (selections, arities, context, path = []) => {
    const indices = new Set<number>();
    const collect = (location: readonly PropertyKey[] | undefined): void => {
      if (
        location != null &&
        path.every((segment, index) => location[index] === segment)
      ) {
        const index = location[path.length];
        if (typeof index === "number") indices.add(index);
      }
    };
    for (const selected of selections.keys()) {
      collect(scopeLocations.get(selected));
    }
    if (context != null) collect(scopePath(context));
    // Before an item has selected a route, its initial declarations still
    // own the token. Later items keep earlier committed routes reserved.
    if (indices.size === 0) indices.add(0);
    return new Set(
      [...indices].flatMap((
        index,
      ) => [
        ...parserScope(parser)(selections, arities, context, [...path, index]),
      ]),
    );
  };
}

/** Tracks declarations after a command or discriminator routes input. @internal */
export function selectableOptionScope(initial: ScopeSource) {
  const source: ScopeSource = (selections, arities, context, path = []) =>
    (selections.get(bindScope(source, path, selections)) ?? initial)(
      selections,
      arities,
      context,
      path,
    );
  return {
    source,
    select(context: ParserContext<unknown>, selected: ScopeSource): void {
      const selections = (context as ScopedContext)[optionScopeKey]?.selections;
      if (selections == null) return;
      selections.set(
        bindScope(source, scopePath(context), selections),
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
  const scope = selectableOptionScope((selections, arities, context, path) => {
    const canSkip = discriminator.canSkip?.(
      context == null
        ? discriminator.initialState
        : inheritAnnotations(context.state, discriminator.initialState),
      context?.exec == null ? undefined : withChildExecPath({
        ...context.exec,
        path: path ?? scopePath(context),
      }, "_discriminator"),
    ) === true;
    return combinedOptionScope([
      discriminator,
      ...(canSkip ? candidates : []),
      ...(fallback == null ? [] : [fallback]),
    ], [
      "_discriminator",
      ...(canSkip ? candidates.map(() => "_branch") : []),
      ...(fallback == null ? [] : ["_branch"]),
    ])(selections, arities, context, path);
  });
  return {
    source: scope.source,
    select(
      context: ParserContext<unknown>,
      branch: Parser<Mode, unknown, unknown>,
    ): void {
      scope.select(
        context,
        combinedOptionScope([discriminator, branch], [
          "_discriminator",
          "_branch",
        ]),
      );
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
  segment?: PropertyKey,
): ParserContext<S> & ScopedContext {
  const inherited = (context as ScopedContext)[optionScopeKey];
  const selections = inherited?.selections ??
    new Map<ScopeSource, ScopeSource>();
  return {
    ...context,
    [optionScopeKey]: {
      names: inherited?.names ?? new Set(),
      sources: new Set([
        ...(inherited?.sources ?? []),
        bindScope(
          parserScope(parser),
          segment == null
            ? scopePath(context)
            : [...scopePath(context), segment],
          selections,
        ),
      ]),
      selections,
    },
  };
}

/** Isolates route selections while probing a competing branch. @internal */
export function forkOptionScope<S>(
  context: ParserContext<S>,
): ParserContext<S> & ScopedContext {
  const scoped = (context as ScopedContext)[optionScopeKey];
  if (scoped == null) return context;
  const selections = new Map(scoped.selections);
  scopeBindings.set(selections, getScopeBindings(scoped.selections));
  return {
    ...context,
    [optionScopeKey]: { ...scoped, selections },
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
  isolate = false,
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
        const scoped = withParserOptionScope(
          isolate ? forkOptionScope(context) : context,
          parser,
        );
        prepare?.(scoped);
        return mapModeValue(
          parser.mode,
          parse.call(parser, scoped),
          (result) => {
            if (!result.success) return result;
            let next: ParserContext<S> & ScopedContext = result.next;
            if (isolate) {
              adoptOptionScope(context, next);
              const parent = (context as ScopedContext)[optionScopeKey];
              const child = (next as ScopedContext)[optionScopeKey];
              if (parent != null && child != null) {
                next = {
                  ...next,
                  [optionScopeKey]: { ...child, selections: parent.selections },
                };
              }
            }
            return {
              ...result,
              next: { ...next, [optionPathKey]: scopePath(context) },
            };
          },
        );
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
      name.startsWith("-") && !name.startsWith("--") &&
      name.length > 2 && !/^-[^-]$/u.test(name) &&
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
  for (let index = 1; index < prefix.length;) {
    const character = String.fromCodePoint(prefix.codePointAt(index)!);
    const nextIndex = index + character.length;
    const remainder = `-${prefix.slice(index)}`;
    for (const name of scope) {
      if (
        name.startsWith("-") && !name.startsWith("--") &&
        name.length > 2 && !/^-[^-]$/u.test(name) &&
        (name.startsWith(remainder) || remainder.startsWith(`${name}=`))
      ) return undefined;
    }
    const short = `-${character}`;
    if (optionNames.includes(short)) {
      return {
        head: prefix.slice(0, nextIndex),
        value: prefix.slice(nextIndex),
      };
    }
    if (!scope.has(short) || !names.flag.has(short) || names.value.has(short)) {
      return undefined;
    }
    index = nextIndex;
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
