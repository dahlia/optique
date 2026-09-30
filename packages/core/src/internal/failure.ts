import type { Message } from "../message.ts";

/** A parse failure whose diagnostic is computed only when it is read. */
export interface DeferredFailure {
  readonly success: false;
  readonly consumed: number;
  readonly error: Message;
}

/**
 * Creates a parse failure without constructing its diagnostic during probing.
 * The getter remains attached to the original failure so descriptor-preserving
 * wrappers and frozen failures share the same result, including thrown values.
 * @internal
 */
export function createDeferredFailure(
  consumed: number,
  createError: () => Message,
): DeferredFailure {
  let settled:
    | { readonly kind: "value"; readonly value: Message }
    | { readonly kind: "throw"; readonly error: unknown }
    | undefined;
  return {
    success: false,
    consumed,
    get error(): Message {
      if (settled == null) {
        try {
          settled = { kind: "value", value: createError() };
        } catch (error) {
          settled = { kind: "throw", error };
        }
      }
      if (settled.kind === "throw") throw settled.error;
      return settled.value;
    },
  };
}

/**
 * Adjusts a failure's consumed depth without reading a deferred diagnostic.
 * Other enumerable properties retain the same copying behavior as object
 * spread, including accessors that depend on the original receiver.
 * @internal
 */
export function withConsumedDepth(
  result: DeferredFailure,
  consumed: number,
): DeferredFailure {
  if (consumed === result.consumed) return result;
  const copy = {
    success: false as const,
    consumed,
    get error(): Message {
      return result.error;
    },
  };
  for (const key of Reflect.ownKeys(result)) {
    if (key === "success" || key === "consumed") continue;
    const descriptor = Object.getOwnPropertyDescriptor(result, key);
    if (!descriptor?.enumerable) continue;
    if (key === "error" && "value" in descriptor) {
      Object.defineProperty(copy, "error", {
        value: descriptor.value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else if (key !== "error") {
      Object.defineProperty(copy, key, {
        value: Reflect.get(result, key),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return copy;
}
