/**
 * Runtime context extension system for Optique parsers.
 *
 * This module provides the annotations system that allows external runtime data
 * to be passed to parsers during the parsing session. This enables use cases like
 * config file fallbacks, environment-based validation, and shared context.
 *
 * @module
 * @since 0.10.0
 */

/**
 * Annotation key symbol for storing data in parser state.
 * @since 0.10.0
 */
export const annotationKey: unique symbol = Symbol.for(
  "@optique/core/parser/annotation",
);

/**
 * Internal marker attached during the first pass of `runWith()` so wrappers
 * with side effects can defer work until two-pass contexts have resolved.
 *
 * @internal
 */
export const firstPassAnnotationKey: unique symbol = Symbol.for(
  "@optique/core/parser/firstPass",
);

/**
 * Internal key for preserving primitive parser state values when annotations
 * are injected into non-object states.
 * @internal
 */
export const annotationStateValueKey: unique symbol = Symbol.for(
  "@optique/core/parser/annotationStateValue",
);

/**
 * Internal marker key that indicates annotation wrapping was injected by
 * Optique internals for non-object states.
 * @internal
 */
export const annotationWrapperKey: unique symbol = Symbol.for(
  "@optique/core/parser/annotationWrapper",
);

/**
 * Internal symbol keys that define Optique's primitive-state annotation
 * wrapper shape.
 * @internal
 */
const annotationWrapperKeys: ReadonlySet<PropertyKey> = new Set<
  PropertyKey
>([
  annotationKey,
  annotationStateValueKey,
  annotationWrapperKey,
]);

const injectedAnnotationWrappers = new WeakSet<object>();
const protectedAnnotationTargets = new WeakMap<object, object>();
const protectedAnnotationStateViews = new WeakMap<object, {
  readonly raw: object;
  readonly view: object;
}>();

interface AnnotationProtectionContext {
  readonly cache: WeakMap<object, object>;
  readonly rewrapProtectedViews: boolean;
}

function throwReadonlyAnnotationMutation(): never {
  throw new TypeError("Cannot mutate read-only annotation data.");
}

function createAnnotationProtectionContext(
  rewrapProtectedViews = false,
): AnnotationProtectionContext {
  return { cache: new WeakMap<object, object>(), rewrapProtectedViews };
}

function registerProtectedAnnotationView<T extends object>(
  context: AnnotationProtectionContext,
  target: object,
  view: T,
): T {
  context.cache.set(target, view);
  protectedAnnotationTargets.set(view, target);
  return view;
}

function cacheProtectedAnnotationViewAlias(
  context: AnnotationProtectionContext,
  alias: object,
  view: object,
): void {
  context.cache.set(alias, view);
}

function isProtectedAnnotationView(value: unknown): value is object {
  return value != null &&
    typeof value === "object" &&
    protectedAnnotationTargets.has(value);
}

function unwrapProtectedAnnotationTarget<T>(value: T): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  return (protectedAnnotationTargets.get(value) as T | undefined) ?? value;
}

function cacheProtectedMethod<T>(
  cache: Map<PropertyKey, unknown>,
  key: PropertyKey,
  factory: () => T,
): T {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached as T;
  }
  const created = factory();
  cache.set(key, created);
  return created;
}

function defineProtectedDataProperty(
  context: AnnotationProtectionContext,
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  const value = protectAnnotationValue(descriptor.value, context);
  Object.defineProperty(target, key, {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: () => value,
    set: () => throwReadonlyAnnotationMutation(),
  });
}

function copyOwnProperties(
  source: object,
  target: object,
  transformValue?: (value: unknown) => unknown,
  excludedKeys?: ReadonlySet<PropertyKey>,
): void {
  const sourcePrototype = Object.getPrototypeOf(source);
  if (Object.getPrototypeOf(target) !== sourcePrototype) {
    Object.setPrototypeOf(target, sourcePrototype);
  }
  for (const key of Reflect.ownKeys(source)) {
    if (excludedKeys?.has(key) === true) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor == null) continue;
    if ("value" in descriptor && transformValue != null) {
      Object.defineProperty(target, key, {
        ...descriptor,
        value: transformValue(descriptor.value),
      });
      continue;
    }
    Object.defineProperty(target, key, descriptor);
  }
}

function normalizeProtectedCollectionItem<T>(
  value: T,
  context: AnnotationProtectionContext,
): T {
  return context.rewrapProtectedViews && isProtectedAnnotationView(value)
    ? unwrapProtectedAnnotationTarget(value)
    : value;
}

function getProtectedProxyFallbackValue(
  target: object,
  key: PropertyKey,
  context: AnnotationProtectionContext,
): unknown {
  const ownDescriptor = Reflect.getOwnPropertyDescriptor(target, key);
  if (ownDescriptor != null && "value" in ownDescriptor) {
    if (
      ownDescriptor.configurable === false && ownDescriptor.writable === false
    ) {
      return ownDescriptor.value;
    }
    const value = ownDescriptor.value;
    return typeof value === "function"
      ? value.bind(target)
      : protectAnnotationValue(value, context);
  }
  const value = Reflect.get(target, key, target);
  return typeof value === "function"
    ? value.bind(target)
    : protectAnnotationValue(value, context);
}

function getProtectedProxyOwnPropertyDescriptor(
  target: object,
  key: PropertyKey,
  context: AnnotationProtectionContext,
): PropertyDescriptor | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
  if (descriptor == null || !("value" in descriptor)) {
    return descriptor;
  }
  if (descriptor.configurable === false && descriptor.writable === false) {
    return descriptor;
  }
  const value = protectAnnotationValue(descriptor.value, context);
  return value === descriptor.value ? descriptor : { ...descriptor, value };
}

function resolveProtectedMapLookup(
  target: ReadonlyMap<unknown, unknown>,
  lookup: unknown,
): { readonly found: false } | {
  readonly found: true;
  readonly value: unknown;
} {
  if (target.has(lookup)) {
    return { found: true, value: target.get(lookup) };
  }
  const rawLookup = unwrapProtectedAnnotationTarget(lookup);
  if (rawLookup !== lookup && target.has(rawLookup)) {
    return { found: true, value: target.get(rawLookup) };
  }
  for (const [entryKey, entryValue] of target.entries()) {
    if (unwrapProtectedAnnotationTarget(entryKey) === rawLookup) {
      return { found: true, value: entryValue };
    }
  }
  return { found: false };
}

function hasProtectedSetLookup(
  target: ReadonlySet<unknown>,
  lookup: unknown,
): boolean {
  if (target.has(lookup)) {
    return true;
  }
  const rawLookup = unwrapProtectedAnnotationTarget(lookup);
  if (rawLookup !== lookup && target.has(rawLookup)) {
    return true;
  }
  for (const value of target.values()) {
    if (unwrapProtectedAnnotationTarget(value) === rawLookup) {
      return true;
    }
  }
  return false;
}

function usesSubclassProxyFallback(
  target: object,
  basePrototype: object,
): boolean {
  return Object.getPrototypeOf(target) !== basePrototype;
}

const regExpExcludedKeys = new Set<PropertyKey>(["lastIndex"]);

function copyRegExpMetadata(
  source: RegExp,
  target: RegExp,
  transformValue?: (value: unknown) => unknown,
): void {
  copyOwnProperties(source, target, transformValue, regExpExcludedKeys);
  target.lastIndex = source.lastIndex;
}

function cloneRegExpShape<T extends RegExp>(source: T): T {
  const cloned = new RegExp(source) as T;
  copyRegExpMetadata(source, cloned);
  return cloned;
}

function createProtectedObjectView<T extends object>(
  target: T,
  context: AnnotationProtectionContext,
): T {
  if (Array.isArray(target)) {
    const view = Object.setPrototypeOf(
      [],
      Object.getPrototypeOf(target),
    ) as unknown[];
    view.length = target.length;
    registerProtectedAnnotationView(context, target, view);
    for (const key of Reflect.ownKeys(target)) {
      if (key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor == null) continue;
      if ("value" in descriptor) {
        defineProtectedDataProperty(context, view, key, descriptor);
        continue;
      }
      Object.defineProperty(view, key, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get == null
          ? undefined
          : () => protectAnnotationValue(descriptor.get!.call(target), context),
        set: () => throwReadonlyAnnotationMutation(),
      });
    }
    return Object.freeze(view) as T;
  }

  const view = Object.create(
    Object.getPrototypeOf(target),
  ) as Record<PropertyKey, unknown>;
  registerProtectedAnnotationView(context, target, view);
  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor == null) continue;
    if ("value" in descriptor) {
      defineProtectedDataProperty(context, view, key, descriptor);
      continue;
    }
    Object.defineProperty(view, key, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get == null
        ? undefined
        : () => protectAnnotationValue(descriptor.get!.call(target), context),
      set: () => throwReadonlyAnnotationMutation(),
    });
  }
  return Object.freeze(view) as T;
}

function createProtectedMapView(
  target: Map<unknown, unknown>,
  context: AnnotationProtectionContext,
): Map<unknown, unknown> {
  if (usesSubclassProxyFallback(target, Map.prototype)) {
    const methodCache = new Map<PropertyKey, unknown>();
    const view = new Proxy(target, {
      get(target, key) {
        if (key === "size") {
          return target.size;
        }
        if (key === "valueOf") {
          return cacheProtectedMethod(methodCache, key, () => () => view);
        }
        if (key === "set" || key === "delete" || key === "clear") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
          );
        }
        if (key === "get") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (lookup: unknown) => {
              const resolved = resolveProtectedMapLookup(target, lookup);
              return resolved.found
                ? protectAnnotationValue(resolved.value, context)
                : undefined;
            },
          );
        }
        if (key === "has") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (lookup: unknown) =>
              resolveProtectedMapLookup(target, lookup).found,
          );
        }
        if (key === "forEach") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
            (
              callback: (
                value: unknown,
                key: unknown,
                map: Map<unknown, unknown>,
              ) => void,
              thisArg?: unknown,
            ) =>
              target.forEach((value, mapKey) => {
                callback.call(
                  thisArg,
                  protectAnnotationValue(value, context),
                  protectAnnotationValue(mapKey, context),
                  view,
                );
              }),
          );
        }
        if (key === "keys") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<unknown> {
                for (const value of target.keys()) {
                  yield protectAnnotationValue(value, context);
                }
              },
          );
        }
        if (key === "values") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<unknown> {
                for (const value of target.values()) {
                  yield protectAnnotationValue(value, context);
                }
              },
          );
        }
        if (key === "entries" || key === Symbol.iterator) {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<readonly [unknown, unknown]> {
                for (const [entryKey, entryValue] of target.entries()) {
                  yield [
                    protectAnnotationValue(entryKey, context),
                    protectAnnotationValue(entryValue, context),
                  ] as const;
                }
              },
          );
        }
        return getProtectedProxyFallbackValue(target, key, context);
      },
      getOwnPropertyDescriptor(target, key) {
        return getProtectedProxyOwnPropertyDescriptor(target, key, context);
      },
      set() {
        throwReadonlyAnnotationMutation();
      },
      defineProperty() {
        throwReadonlyAnnotationMutation();
      },
      deleteProperty() {
        throwReadonlyAnnotationMutation();
      },
      setPrototypeOf() {
        throwReadonlyAnnotationMutation();
      },
      preventExtensions() {
        throwReadonlyAnnotationMutation();
      },
    });
    return registerProtectedAnnotationView(context, target, view);
  }

  const methodCache = new Map<PropertyKey, unknown>();
  const cloned = new Map<unknown, unknown>();
  for (const [entryKey, entryValue] of target.entries()) {
    cloned.set(
      normalizeProtectedCollectionItem(entryKey, context),
      normalizeProtectedCollectionItem(entryValue, context),
    );
  }
  const view = new Proxy(cloned, {
    get(clonedTarget, key) {
      if (key === "size") {
        return clonedTarget.size;
      }
      if (key === "valueOf") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => () => view,
        );
      }
      if (key === "set" || key === "delete" || key === "clear") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
        );
      }
      if (key === "get") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (lookup: unknown) => {
            if (clonedTarget.has(lookup)) {
              return protectAnnotationValue(clonedTarget.get(lookup), context);
            }
            return protectAnnotationValue(
              clonedTarget.get(unwrapProtectedAnnotationTarget(lookup)),
              context,
            );
          },
        );
      }
      if (key === "has") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (lookup: unknown) =>
            clonedTarget.has(lookup) ||
            clonedTarget.has(unwrapProtectedAnnotationTarget(lookup)),
        );
      }
      if (key === "forEach") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
          (
            callback: (
              value: unknown,
              key: unknown,
              map: Map<unknown, unknown>,
            ) => void,
            thisArg?: unknown,
          ) =>
            clonedTarget.forEach((value, mapKey) => {
              callback.call(
                thisArg,
                protectAnnotationValue(value, context),
                protectAnnotationValue(mapKey, context),
                view,
              );
            }),
        );
      }
      if (key === "keys") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<unknown> {
              for (const value of clonedTarget.keys()) {
                yield protectAnnotationValue(value, context);
              }
            },
        );
      }
      if (key === "values") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<unknown> {
              for (const value of clonedTarget.values()) {
                yield protectAnnotationValue(value, context);
              }
            },
        );
      }
      if (key === "entries" || key === Symbol.iterator) {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<readonly [unknown, unknown]> {
              for (const [entryKey, entryValue] of clonedTarget.entries()) {
                yield [
                  protectAnnotationValue(entryKey, context),
                  protectAnnotationValue(entryValue, context),
                ] as const;
              }
            },
        );
      }
      const value = Reflect.get(clonedTarget, key, clonedTarget);
      return typeof value === "function"
        ? value.bind(clonedTarget)
        : protectAnnotationValue(value, context);
    },
    set() {
      throwReadonlyAnnotationMutation();
    },
    defineProperty() {
      throwReadonlyAnnotationMutation();
    },
    deleteProperty() {
      throwReadonlyAnnotationMutation();
    },
    setPrototypeOf() {
      throwReadonlyAnnotationMutation();
    },
    preventExtensions() {
      throwReadonlyAnnotationMutation();
    },
  });
  registerProtectedAnnotationView(context, target, view);
  cacheProtectedAnnotationViewAlias(context, cloned, view);
  copyOwnProperties(
    target,
    cloned,
    (value) => protectAnnotationValue(value, context),
  );
  return view;
}

function createProtectedSetView(
  target: Set<unknown>,
  context: AnnotationProtectionContext,
): Set<unknown> {
  if (usesSubclassProxyFallback(target, Set.prototype)) {
    const methodCache = new Map<PropertyKey, unknown>();
    const view = new Proxy(target, {
      get(target, key) {
        if (key === "size") {
          return target.size;
        }
        if (key === "valueOf") {
          return cacheProtectedMethod(methodCache, key, () => () => view);
        }
        if (key === "add" || key === "delete" || key === "clear") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
          );
        }
        if (key === "has") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (lookup: unknown) => hasProtectedSetLookup(target, lookup),
          );
        }
        if (key === "forEach") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
            (
              callback: (
                value: unknown,
                key: unknown,
                set: Set<unknown>,
              ) => void,
              thisArg?: unknown,
            ) =>
              target.forEach((value) => {
                const protectedValue = protectAnnotationValue(value, context);
                callback.call(thisArg, protectedValue, protectedValue, view);
              }),
          );
        }
        if (
          key === "keys" ||
          key === "values" ||
          key === Symbol.iterator
        ) {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<unknown> {
                for (const value of target.values()) {
                  yield protectAnnotationValue(value, context);
                }
              },
          );
        }
        if (key === "entries") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<readonly [unknown, unknown]> {
                for (const value of target.values()) {
                  const protectedValue = protectAnnotationValue(value, context);
                  yield [protectedValue, protectedValue] as const;
                }
              },
          );
        }
        return getProtectedProxyFallbackValue(target, key, context);
      },
      getOwnPropertyDescriptor(target, key) {
        return getProtectedProxyOwnPropertyDescriptor(target, key, context);
      },
      set() {
        throwReadonlyAnnotationMutation();
      },
      defineProperty() {
        throwReadonlyAnnotationMutation();
      },
      deleteProperty() {
        throwReadonlyAnnotationMutation();
      },
      setPrototypeOf() {
        throwReadonlyAnnotationMutation();
      },
      preventExtensions() {
        throwReadonlyAnnotationMutation();
      },
    });
    return registerProtectedAnnotationView(context, target, view);
  }

  const methodCache = new Map<PropertyKey, unknown>();
  const cloned = new Set<unknown>();
  for (const value of target.values()) {
    cloned.add(normalizeProtectedCollectionItem(value, context));
  }
  const view = new Proxy(cloned, {
    get(clonedTarget, key) {
      if (key === "size") {
        return clonedTarget.size;
      }
      if (key === "valueOf") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => () => view,
        );
      }
      if (key === "add" || key === "delete" || key === "clear") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
        );
      }
      if (key === "has") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (lookup: unknown) =>
            clonedTarget.has(lookup) ||
            clonedTarget.has(unwrapProtectedAnnotationTarget(lookup)),
        );
      }
      if (key === "forEach") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
          (
            callback: (
              value: unknown,
              key: unknown,
              set: Set<unknown>,
            ) => void,
            thisArg?: unknown,
          ) =>
            clonedTarget.forEach((value) => {
              const protectedValue = protectAnnotationValue(value, context);
              callback.call(thisArg, protectedValue, protectedValue, view);
            }),
        );
      }
      if (
        key === "keys" ||
        key === "values" ||
        key === Symbol.iterator
      ) {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<unknown> {
              for (const value of clonedTarget.values()) {
                yield protectAnnotationValue(value, context);
              }
            },
        );
      }
      if (key === "entries") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<readonly [unknown, unknown]> {
              for (const value of clonedTarget.values()) {
                const protectedValue = protectAnnotationValue(value, context);
                yield [protectedValue, protectedValue] as const;
              }
            },
        );
      }
      const value = Reflect.get(clonedTarget, key, clonedTarget);
      return typeof value === "function"
        ? value.bind(clonedTarget)
        : protectAnnotationValue(value, context);
    },
    set() {
      throwReadonlyAnnotationMutation();
    },
    defineProperty() {
      throwReadonlyAnnotationMutation();
    },
    deleteProperty() {
      throwReadonlyAnnotationMutation();
    },
    setPrototypeOf() {
      throwReadonlyAnnotationMutation();
    },
    preventExtensions() {
      throwReadonlyAnnotationMutation();
    },
  });
  registerProtectedAnnotationView(context, target, view);
  cacheProtectedAnnotationViewAlias(context, cloned, view);
  copyOwnProperties(
    target,
    cloned,
    (value) => protectAnnotationValue(value, context),
  );
  return view;
}

function createProtectedDateView(
  target: Date,
  context: AnnotationProtectionContext,
): Date {
  if (usesSubclassProxyFallback(target, Date.prototype)) {
    const methodCache = new Map<PropertyKey, unknown>();
    const view = new Proxy(target, {
      get(target, key) {
        if (typeof key === "string" && key.startsWith("set")) {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
          );
        }
        return getProtectedProxyFallbackValue(target, key, context);
      },
      getOwnPropertyDescriptor(target, key) {
        return getProtectedProxyOwnPropertyDescriptor(target, key, context);
      },
      set() {
        throwReadonlyAnnotationMutation();
      },
      defineProperty() {
        throwReadonlyAnnotationMutation();
      },
      deleteProperty() {
        throwReadonlyAnnotationMutation();
      },
      setPrototypeOf() {
        throwReadonlyAnnotationMutation();
      },
      preventExtensions() {
        throwReadonlyAnnotationMutation();
      },
    });
    return registerProtectedAnnotationView(context, target, view);
  }

  const methodCache = new Map<PropertyKey, unknown>();
  const cloned = new Date(target.getTime());
  const view = new Proxy(cloned, {
    get(clonedTarget, key) {
      const value = Reflect.get(clonedTarget, key, clonedTarget);
      if (typeof key === "string" && key.startsWith("set")) {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
        );
      }
      return typeof value === "function"
        ? value.bind(clonedTarget)
        : protectAnnotationValue(value, context);
    },
    set() {
      throwReadonlyAnnotationMutation();
    },
    defineProperty() {
      throwReadonlyAnnotationMutation();
    },
    deleteProperty() {
      throwReadonlyAnnotationMutation();
    },
    setPrototypeOf() {
      throwReadonlyAnnotationMutation();
    },
    preventExtensions() {
      throwReadonlyAnnotationMutation();
    },
  });
  registerProtectedAnnotationView(context, target, view);
  cacheProtectedAnnotationViewAlias(context, cloned, view);
  copyOwnProperties(
    target,
    cloned,
    (value) => protectAnnotationValue(value, context),
  );
  return view;
}

function createProtectedRegExpView(
  target: RegExp,
  context: AnnotationProtectionContext,
): RegExp {
  const methodCache = new Map<PropertyKey, unknown>();
  const cloned = new RegExp(target) as RegExp;
  const view = new Proxy(cloned, {
    get(clonedTarget, key) {
      if (key === "compile") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
        );
      }
      if (key === "valueOf") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => () => view,
        );
      }
      const ownDescriptor = Object.getOwnPropertyDescriptor(clonedTarget, key);
      if (ownDescriptor != null && "value" in ownDescriptor) {
        return ownDescriptor.value;
      }
      const value = Reflect.get(clonedTarget, key, clonedTarget);
      return typeof value === "function"
        ? value.bind(clonedTarget)
        : protectAnnotationValue(value, context);
    },
    set() {
      throwReadonlyAnnotationMutation();
    },
    defineProperty() {
      throwReadonlyAnnotationMutation();
    },
    deleteProperty() {
      throwReadonlyAnnotationMutation();
    },
    setPrototypeOf() {
      throwReadonlyAnnotationMutation();
    },
    preventExtensions() {
      throwReadonlyAnnotationMutation();
    },
  });
  registerProtectedAnnotationView(context, target, view);
  cacheProtectedAnnotationViewAlias(context, cloned, view);
  copyRegExpMetadata(
    target,
    cloned,
    (value) => protectAnnotationValue(value, context),
  );
  return view;
}

function createProtectedURLSearchParamsView(
  target: URLSearchParams,
  context: AnnotationProtectionContext,
): URLSearchParams {
  if (usesSubclassProxyFallback(target, URLSearchParams.prototype)) {
    const methodCache = new Map<PropertyKey, unknown>();
    const view = new Proxy(target, {
      get(target, key) {
        if (
          key === "append" ||
          key === "delete" ||
          key === "set" ||
          key === "sort"
        ) {
          return cacheProtectedMethod(
            methodCache,
            key,
            () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
          );
        }
        if (key === "valueOf") {
          return cacheProtectedMethod(methodCache, key, () => () => view);
        }
        if (key === "forEach") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
            (
              callback: (
                value: string,
                key: string,
                searchParams: URLSearchParams,
              ) => void,
              thisArg?: unknown,
            ) =>
              target.forEach((value, name) => {
                callback.call(thisArg, value, name, view);
              }),
          );
        }
        if (key === "keys" || key === "values") {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<string> {
                const iterator = key === "keys"
                  ? target.keys()
                  : target.values();
                for (const value of iterator) {
                  yield value;
                }
              },
          );
        }
        if (key === "entries" || key === Symbol.iterator) {
          return cacheProtectedMethod(
            methodCache,
            key,
            () =>
              function* (): IterableIterator<readonly [string, string]> {
                for (const entry of target.entries()) {
                  yield entry;
                }
              },
          );
        }
        return getProtectedProxyFallbackValue(target, key, context);
      },
      getOwnPropertyDescriptor(target, key) {
        return getProtectedProxyOwnPropertyDescriptor(target, key, context);
      },
      set() {
        throwReadonlyAnnotationMutation();
      },
      defineProperty() {
        throwReadonlyAnnotationMutation();
      },
      deleteProperty() {
        throwReadonlyAnnotationMutation();
      },
      setPrototypeOf() {
        throwReadonlyAnnotationMutation();
      },
      preventExtensions() {
        throwReadonlyAnnotationMutation();
      },
    });
    return registerProtectedAnnotationView(context, target, view);
  }

  const methodCache = new Map<PropertyKey, unknown>();
  const cloned = new URLSearchParams(target);
  const view = new Proxy(cloned, {
    get(clonedTarget, key) {
      if (
        key === "append" ||
        key === "delete" ||
        key === "set" ||
        key === "sort"
      ) {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => (..._args: unknown[]) => throwReadonlyAnnotationMutation(),
        );
      }
      if (key === "valueOf") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () => () => view,
        );
      }
      if (key === "forEach") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
          (
            callback: (
              value: string,
              key: string,
              searchParams: URLSearchParams,
            ) => void,
            thisArg?: unknown,
          ) =>
            clonedTarget.forEach((value, name) => {
              callback.call(thisArg, value, name, view);
            }),
        );
      }
      if (key === "keys" || key === "values") {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<string> {
              const iterator = key === "keys"
                ? clonedTarget.keys()
                : clonedTarget.values();
              for (const value of iterator) {
                yield value;
              }
            },
        );
      }
      if (key === "entries" || key === Symbol.iterator) {
        return cacheProtectedMethod(
          methodCache,
          key,
          () =>
            function* (): IterableIterator<readonly [string, string]> {
              for (const entry of clonedTarget.entries()) {
                yield entry;
              }
            },
        );
      }
      const value = Reflect.get(clonedTarget, key, clonedTarget);
      return typeof value === "function"
        ? value.bind(clonedTarget)
        : protectAnnotationValue(value, context);
    },
    set() {
      throwReadonlyAnnotationMutation();
    },
    defineProperty() {
      throwReadonlyAnnotationMutation();
    },
    deleteProperty() {
      throwReadonlyAnnotationMutation();
    },
    setPrototypeOf() {
      throwReadonlyAnnotationMutation();
    },
    preventExtensions() {
      throwReadonlyAnnotationMutation();
    },
  });
  registerProtectedAnnotationView(context, target, view);
  cacheProtectedAnnotationViewAlias(context, cloned, view);
  copyOwnProperties(
    target,
    cloned,
    (value) => protectAnnotationValue(value, context),
  );
  return view;
}

function createProtectedURLView(
  target: URL,
  context: AnnotationProtectionContext,
): URL {
  if (usesSubclassProxyFallback(target, URL.prototype)) {
    const methodCache = new Map<PropertyKey, unknown>();
    const view = new Proxy(target, {
      get(target, key) {
        if (key === "valueOf") {
          return cacheProtectedMethod(methodCache, key, () => () => view);
        }
        if (key === "searchParams") {
          return protectAnnotationValue(target.searchParams, context);
        }
        return getProtectedProxyFallbackValue(target, key, context);
      },
      getOwnPropertyDescriptor(target, key) {
        return getProtectedProxyOwnPropertyDescriptor(target, key, context);
      },
      set() {
        throwReadonlyAnnotationMutation();
      },
      defineProperty() {
        throwReadonlyAnnotationMutation();
      },
      deleteProperty() {
        throwReadonlyAnnotationMutation();
      },
      setPrototypeOf() {
        throwReadonlyAnnotationMutation();
      },
      preventExtensions() {
        throwReadonlyAnnotationMutation();
      },
    });
    return registerProtectedAnnotationView(context, target, view);
  }

  const cloned = new URL(target.href);
  const view = new Proxy(cloned, {
    get(clonedTarget, key) {
      if (key === "valueOf") {
        return () => view;
      }
      if (key === "searchParams") {
        return protectAnnotationValue(clonedTarget.searchParams, context);
      }
      const value = Reflect.get(clonedTarget, key, clonedTarget);
      return typeof value === "function"
        ? value.bind(clonedTarget)
        : protectAnnotationValue(value, context);
    },
    set() {
      throwReadonlyAnnotationMutation();
    },
    defineProperty() {
      throwReadonlyAnnotationMutation();
    },
    deleteProperty() {
      throwReadonlyAnnotationMutation();
    },
    setPrototypeOf() {
      throwReadonlyAnnotationMutation();
    },
    preventExtensions() {
      throwReadonlyAnnotationMutation();
    },
  });
  registerProtectedAnnotationView(context, target, view);
  cacheProtectedAnnotationViewAlias(context, cloned, view);
  copyOwnProperties(
    target,
    cloned,
    (value) => protectAnnotationValue(value, context),
  );
  return view;
}

function protectAnnotationValue<T>(
  value: T,
  context: AnnotationProtectionContext,
): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  const isProtectedView = isProtectedAnnotationView(value);
  if (isProtectedView && !context.rewrapProtectedViews) {
    return value;
  }
  const target = isProtectedView
    ? unwrapProtectedAnnotationTarget(value as object)
    : value as object;
  const cached = context.cache.get(target);
  if (cached !== undefined) {
    return cached as T;
  }
  if (target instanceof Map) {
    return createProtectedMapView(target, context) as T;
  }
  if (target instanceof Set) {
    return createProtectedSetView(target, context) as T;
  }
  if (target instanceof Date) {
    return createProtectedDateView(target, context) as T;
  }
  if (target instanceof RegExp) {
    return createProtectedRegExpView(target, context) as T;
  }
  if (
    typeof URLSearchParams === "function" &&
    target instanceof URLSearchParams
  ) {
    return createProtectedURLSearchParamsView(target, context) as T;
  }
  if (typeof URL === "function" && target instanceof URL) {
    return createProtectedURLView(target, context) as T;
  }
  if (Array.isArray(target)) {
    return createProtectedObjectView(target, context) as T;
  }
  const proto = Object.getPrototypeOf(target);
  if (proto === Object.prototype || proto === null) {
    return createProtectedObjectView(target, context) as T;
  }
  return value;
}

/**
 * Annotations that can be passed to parsers during execution.
 * Allows external packages to provide additional data that parsers can access
 * during complete() or parse() phases.
 *
 * @example
 * ```typescript
 * const myDataKey = Symbol.for("@my-package/data");
 * const result = parse(parser, args, {
 *   annotations: {
 *     [myDataKey]: { foo: "bar" }
 *   }
 * });
 * ```
 * @since 0.10.0
 */
export type Annotations = Record<symbol, unknown>;

/**
 * Read-only annotation view returned from parser state.
 *
 * Top-level annotation records are exposed as read-only objects, and supported
 * nested container values (plain objects, arrays, `Map`, `Set`, `Date`,
 * `RegExp`, `URL`, and `URLSearchParams`) are surfaced through protected
 * views that throw on ordinary mutation attempts.
 *
 * Opaque live objects and functions remain reference-preserving.
 *
 * @since 1.0.0
 */
export type ReadonlyAnnotations = Readonly<Annotations>;
type AnnotationInput = Annotations | ReadonlyAnnotations;

/**
 * Normalizes annotation input for a fresh parse run.
 *
 * When callers feed a protected annotation view returned by `getAnnotations()`
 * back into a new parse entrypoint, Optique unwraps it to the caller-owned
 * record first so the new run gets its own protected views.
 *
 * @param annotations The caller-supplied annotations input.
 * @returns The raw annotation record to inject for the new run.
 * @internal
 */
export function normalizeRunAnnotationInput(
  annotations: AnnotationInput,
): AnnotationInput {
  return isProtectedAnnotationView(annotations)
    ? unwrapProtectedAnnotationTarget(annotations)
    : annotations;
}

function injectAnnotationsWithContext<TState>(
  state: TState,
  annotations: AnnotationInput,
  context: AnnotationProtectionContext,
): TState {
  const protectedAnnotations = protectAnnotationValue(annotations, context);
  if (state == null || typeof state !== "object") {
    const wrapper: Record<PropertyKey, unknown> = {};
    Object.defineProperties(wrapper, {
      [annotationKey]: {
        value: protectedAnnotations,
        enumerable: true,
        writable: true,
        configurable: true,
      },
      // Internal wrapper markers should not be copied by object spread.
      [annotationStateValueKey]: {
        value: state,
        enumerable: false,
        writable: true,
        configurable: true,
      },
      [annotationWrapperKey]: {
        value: true,
        enumerable: false,
        writable: true,
        configurable: true,
      },
    });
    injectedAnnotationWrappers.add(wrapper);
    return wrapper as TState;
  }
  if (Array.isArray(state)) {
    const cloned = [...state];
    (cloned as typeof cloned & { [annotationKey]?: ReadonlyAnnotations })[
      annotationKey
    ] = protectedAnnotations;
    return cloned as TState;
  }
  if (isInjectedAnnotationWrapper(state)) {
    (
      state as TState & {
        [annotationKey]?: ReadonlyAnnotations;
      }
    )[annotationKey] = protectedAnnotations;
    return state;
  }
  if (state instanceof Date) {
    const cloned = new Date(state.getTime()) as Date & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = protectedAnnotations;
    return cloned as TState;
  }
  if (state instanceof Map) {
    const cloned = new Map(state) as Map<unknown, unknown> & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = protectedAnnotations;
    return cloned as TState;
  }
  if (state instanceof Set) {
    const cloned = new Set(state) as Set<unknown> & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = protectedAnnotations;
    return cloned as TState;
  }
  if (state instanceof RegExp) {
    const cloned = cloneRegExpShape(state) as RegExp & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = protectedAnnotations;
    return cloned as TState;
  }
  const proto = Object.getPrototypeOf(state);
  if (proto === Object.prototype || proto === null) {
    return {
      ...(state as Record<PropertyKey, unknown>),
      [annotationKey]: protectedAnnotations,
    } as TState;
  }
  const cloned = Object.create(
    proto,
    Object.getOwnPropertyDescriptors(state as Record<PropertyKey, unknown>),
  ) as TState & { [annotationKey]?: ReadonlyAnnotations };
  cloned[annotationKey] = protectedAnnotations;
  return cloned;
}

/**
 * Options for parse functions.
 * @since 0.10.0
 */
export interface ParseOptions {
  /**
   * Annotations to attach to the parsing session.
   * Parsers can access these annotations via getAnnotations(state).
   *
   * Optique treats these values as immutable input and exposes them back to
   * parsers only through protected read-only views.
   */
  readonly annotations?: Annotations | ReadonlyAnnotations;
}

/**
 * Extracts annotations from parser state.
 *
 * @param state Parser state that may contain annotations
 * @returns Read-only annotations view or undefined if no annotations are
 *          present
 * @since 0.10.0
 * @since 1.0.0 Returns protected read-only annotation views instead of
 *              caller-owned objects.
 *
 * @example
 * ```typescript
 * const annotations = getAnnotations(state);
 * const myData = annotations?.[myDataKey];
 * ```
 */
export function getAnnotations(
  state: unknown,
): ReadonlyAnnotations | undefined {
  if (state == null || typeof state !== "object") {
    return undefined;
  }
  const stateObj = state as Record<symbol, unknown>;
  const annotations = stateObj[annotationKey];
  if (annotations != null && typeof annotations === "object") {
    if (isProtectedAnnotationView(annotations)) {
      return annotations as ReadonlyAnnotations;
    }
    const cached = protectedAnnotationStateViews.get(stateObj);
    if (cached?.raw === annotations) {
      return cached.view as ReadonlyAnnotations;
    }
    const protectedView = protectAnnotationValue(
      annotations as AnnotationInput,
      createAnnotationProtectionContext(),
    );
    protectedAnnotationStateViews.set(stateObj, {
      raw: annotations as object,
      view: protectedView as object,
    });
    return protectedView;
  }
  return undefined;
}

/**
 * Reattaches annotations to a freshly created array state.
 *
 * Array spread copies elements but drops symbol properties, so parsers that
 * rebuild array states need to copy annotations back explicitly.
 *
 * @param source The original state that may carry annotations.
 * @param target The freshly created array state.
 * @returns The target array, with annotations copied when available.
 * @internal
 */
export function annotateFreshArray<T>(
  source: unknown,
  target: readonly T[],
): readonly T[] {
  const annotations = getAnnotations(source);
  if (annotations === undefined) {
    return target;
  }
  const annotated = target as readonly T[] & {
    [annotationKey]?: ReadonlyAnnotations;
  };
  annotated[annotationKey] = annotations;
  return annotated as readonly T[];
}

/**
 * Propagates annotations from one parser state to another.
 *
 * This is mainly used by parsers that rebuild array states with spread syntax.
 * Array spread copies elements but drops custom symbol properties, so we need
 * to reattach annotations explicitly when present.
 *
 * @param source The original state that may carry annotations.
 * @param target The new state to receive annotations.
 * @returns The target state, with annotations copied when available.
 * @internal
 */
export function inheritAnnotations<T>(source: unknown, target: T): T {
  const annotations = getAnnotations(source);
  if (annotations === undefined) {
    return target;
  }
  if (target == null || typeof target !== "object") {
    return injectAnnotations(target, annotations);
  }
  if (isInjectedAnnotationWrapper(target)) {
    return injectAnnotations(target, annotations);
  }
  if (Array.isArray(target)) {
    const cloned = [...target];
    (cloned as typeof cloned & { [annotationKey]?: ReadonlyAnnotations })[
      annotationKey
    ] = annotations;
    return cloned as T;
  }
  if (target instanceof Date) {
    const cloned = new Date(target.getTime()) as Date & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (target instanceof Map) {
    const cloned = new Map(target) as Map<unknown, unknown> & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (target instanceof Set) {
    const cloned = new Set(target) as Set<unknown> & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (target instanceof RegExp) {
    const cloned = cloneRegExpShape(target) as RegExp & {
      [annotationKey]?: ReadonlyAnnotations;
    };
    cloned[annotationKey] = annotations;
    return cloned as T;
  }
  if (
    Object.getPrototypeOf(target) !== Object.prototype &&
    Object.getPrototypeOf(target) !== null
  ) {
    // Avoid mutating non-plain objects because they may be shared parser
    // initialState values, which can leak annotations across runs.
    return target;
  }
  const cloned = Object.create(
    Object.getPrototypeOf(target),
    Object.getOwnPropertyDescriptors(target),
  ) as T & { [annotationKey]?: ReadonlyAnnotations };
  cloned[annotationKey] = annotations;
  return cloned;
}

/**
 * Returns whether an annotations record carries at least one own symbol key.
 *
 * An annotations object with no own symbol keys is treated as a no-op by the
 * injection pipeline: it should behave identically to omitting the
 * `annotations` option entirely.  `null` and `undefined` are accepted for
 * call-site convenience and always return `false`.
 *
 * @param annotations The annotations record to check.
 * @returns `true` when the record has at least one own symbol key.
 * @internal
 */
export function hasMeaningfulAnnotations(
  annotations: AnnotationInput | null | undefined,
): annotations is AnnotationInput {
  return annotations != null &&
    Object.getOwnPropertySymbols(annotations).length > 0;
}

/**
 * Injects annotations into parser state while preserving state shape.
 *
 * - Primitive, null, and undefined states are wrapped with internal metadata.
 * - Array states are cloned and annotated without mutating the original.
 * - Plain object states are shallow-cloned with annotations attached.
 * - Built-in object states (Date/Map/Set/RegExp) are cloned by constructor.
 * - Other non-plain object states are cloned via prototype/descriptors.
 * - If the `annotations` record has no own symbol keys, the state is
 *   returned unchanged; an empty annotations object is a no-op.
 *
 * @param state The parser state to annotate.
 * @param annotations The annotations to inject.
 * @returns Annotated state.
 * @internal
 */
export function injectAnnotations<TState>(
  state: TState,
  annotations: AnnotationInput,
): TState {
  if (!hasMeaningfulAnnotations(annotations)) {
    return state;
  }
  return injectAnnotationsWithContext(
    state,
    annotations,
    createAnnotationProtectionContext(),
  );
}

/**
 * Injects annotations for a fresh parse run.
 *
 * This path re-wraps protected views from previous runs so stateful container
 * internals remain isolated across parse entrypoints.
 *
 * @param state The parser state to annotate.
 * @param annotations The annotations to inject.
 * @returns Annotated state for the fresh run.
 * @internal
 */
export function injectFreshRunAnnotations<TState>(
  state: TState,
  annotations: AnnotationInput,
): TState {
  if (!hasMeaningfulAnnotations(annotations)) {
    return state;
  }
  return injectAnnotationsWithContext(
    state,
    normalizeRunAnnotationInput(annotations),
    createAnnotationProtectionContext(true),
  );
}

/**
 * Unwraps a primitive-state annotation wrapper injected by Optique internals.
 *
 * @param value Value to potentially unwrap.
 * @returns The unwrapped primitive value when the input is an injected wrapper;
 *          otherwise the original value.
 * @internal
 */
export function unwrapInjectedAnnotationWrapper<T>(value: T): T {
  if (value == null || typeof value !== "object") {
    return value;
  }
  const valueRecord = value as Record<PropertyKey, unknown>;
  if (valueRecord[annotationWrapperKey] !== true) {
    return value;
  }
  const ownKeys = Reflect.ownKeys(valueRecord);
  if (
    ownKeys.length === 3 &&
    ownKeys.every((key) => annotationWrapperKeys.has(key)) &&
    isInjectedAnnotationWrapper(value)
  ) {
    return valueRecord[annotationStateValueKey] as T;
  }
  return value;
}

/**
 * Returns whether the given value is an internal primitive-state annotation
 * wrapper that was injected by Optique.
 *
 * @param value Value to check.
 * @returns `true` if the value is an injected internal wrapper.
 * @internal
 */
export function isInjectedAnnotationWrapper(value: unknown): boolean {
  return value != null &&
    typeof value === "object" &&
    injectedAnnotationWrappers.has(value);
}
