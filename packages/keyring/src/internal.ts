import { getAnnotations } from "@optique/core/annotations";
import {
  inheritAnnotations,
  withAnnotationView,
} from "@optique/core/extension";
import type { ExecutionContext } from "@optique/core/parser";

type RunResults = NonNullable<
  ExecutionContext["effectfulCompletionSession"]
>["results"];

export function createRunLookup<T>(): (
  results: RunResults | undefined,
  path: readonly PropertyKey[] | undefined,
  lookup: () => Promise<T>,
) => Promise<T> {
  const cacheByRun = new WeakMap<RunResults, {
    readonly values: Map<string, Promise<T>>;
    readonly symbolIds: Map<symbol, number>;
  }>();

  return (results, path, lookup) => {
    if (results == null) return lookup();

    let cache = cacheByRun.get(results);
    if (cache == null) {
      cache = { values: new Map(), symbolIds: new Map() };
      cacheByRun.set(results, cache);
    }

    const { values, symbolIds } = cache;
    const key = (path ?? []).map((segment) => {
      if (typeof segment === "symbol") {
        let id = symbolIds.get(segment);
        if (id == null) {
          id = symbolIds.size;
          symbolIds.set(segment, id);
        }
        return `y${id}:`;
      }

      const tag = typeof segment === "number" ? "n" : "s";
      const text = String(segment);
      return `${tag}${text.length}:${text}`;
    }).join("");

    const cached = values.get(key);
    if (cached != null) return cached;

    const pending = Promise.resolve().then(lookup);
    values.set(key, pending);
    return pending;
  };
}

export function withAnnotatedInnerState<TState, TResult>(
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
  if (inheritedState !== innerState) return run(inheritedState);

  return innerStateIsObject
    ? run(withAnnotationView(innerState, annotations))
    : run(innerState);
}
