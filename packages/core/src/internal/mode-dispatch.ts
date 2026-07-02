/**
 * Helpers for mode-based dispatch.
 *
 * This internal implementation module contains the mode-dispatch helpers used
 * by Optique itself, including the supported functions re-exported from
 * `@optique/core/extension`. The type assertions in this file are necessary
 * due to TypeScript's limitation in narrowing conditional types based on
 * runtime checks.
 *
 * @since 0.10.0
 */

import type { Mode, ModeIterable, ModeValue } from "../parser.ts";

/**
 * Dispatches to sync or async implementation based on mode.
 *
 * This function encapsulates the necessary type assertions when branching
 * on runtime mode values. TypeScript cannot narrow `ModeValue<M, T>` based
 * on `mode === "async"` checks, so we must use type assertions.
 *
 * @param mode The execution mode.
 * @param syncFn Function to call for sync execution.
 * @param asyncFn Function to call for async execution.
 * @returns The result with correct mode wrapping.
 * @since 0.10.0
 */
export function dispatchByMode<M extends Mode, T>(
  mode: M,
  syncFn: () => T,
  asyncFn: () => Promise<T>,
): ModeValue<M, T> {
  if (mode === "async") {
    return asyncFn() as ModeValue<M, T>;
  }
  return syncFn() as ModeValue<M, T>;
}

/**
 * Wraps a value so it matches the parser execution mode.
 *
 * @param mode The execution mode.
 * @param value The value to wrap.
 * @returns The wrapped value with correct mode semantics.
 * @since 1.0.0
 */
export function wrapForMode<T>(mode: "sync", value: T | Promise<T>): T;
export function wrapForMode<T>(
  mode: "async",
  value: T | Promise<T>,
): Promise<T>;
export function wrapForMode<M extends Mode, T>(
  mode: M,
  value: T | Promise<T>,
): ModeValue<M, T>;
export function wrapForMode<T>(
  mode: Mode,
  value: T | Promise<T>,
): T | Promise<T> {
  if (mode === "async") {
    return Promise.resolve(value);
  }
  if (value instanceof Promise) {
    throw new TypeError("Synchronous mode cannot wrap Promise value.");
  }
  return value;
}

/**
 * Maps a mode-wrapped value while preserving its execution mode.
 *
 * @param mode The execution mode.
 * @param value The mode-wrapped value to transform.
 * @param mapFn Mapping function applied to the unwrapped value.
 * @returns The mapped value with correct mode wrapping.
 * @since 1.0.0
 */
export function mapModeValue<M extends Mode, T, U>(
  mode: M,
  value: ModeValue<M, T>,
  mapFn: (value: T) => U,
): ModeValue<M, U> {
  if (mode === "async") {
    return Promise.resolve(value as T | Promise<T>).then(mapFn) as ModeValue<
      M,
      U
    >;
  }
  if (value instanceof Promise) {
    throw new TypeError("Synchronous mode cannot map Promise value.");
  }
  return mapFn(value as T) as ModeValue<M, U>;
}

/**
 * Maps a value or promise while preserving the declared execution mode.
 *
 * Some internal extension hooks predate `ModeValue` and expose a plain
 * `T | Promise<T>` return type. This helper adapts those hooks back into the
 * mode-dispatch boundary before applying a mapping function.
 *
 * @param mode The execution mode.
 * @param value The value or promise to transform.
 * @param mapFn Mapping function applied to the unwrapped value.
 * @returns The mapped value with correct mode wrapping.
 * @internal
 */
export function mapMaybePromiseByMode<M extends Mode, T, U>(
  mode: M,
  value: T | Promise<T>,
  mapFn: (value: T) => U,
): ModeValue<M, U> {
  return mapModeValue(mode, wrapForMode(mode, value), mapFn);
}

/**
 * Adapts an iterable or async iterable to the declared execution mode.
 *
 * @param mode The execution mode.
 * @param value The iterable to adapt.
 * @returns The iterable with correct mode wrapping.
 * @throws {TypeError} If a synchronous mode receives an async iterable.
 * @internal
 */
export function wrapIterableForMode<M extends Mode, T>(
  mode: M,
  value: Iterable<T> | AsyncIterable<T>,
): ModeIterable<M, T> {
  const canCheckAsyncIterator = value != null &&
    (typeof value === "object" || typeof value === "function");
  return dispatchIterableByMode(
    mode,
    () => {
      if (canCheckAsyncIterator && Symbol.asyncIterator in value) {
        throw new TypeError(
          "Synchronous mode cannot wrap AsyncIterable value.",
        );
      }
      return value;
    },
    () => {
      if (canCheckAsyncIterator && Symbol.asyncIterator in value) return value;
      return (async function* () {
        yield* value;
      })();
    },
  );
}

/**
 * Dispatches iterable to sync or async implementation based on mode.
 *
 * @param mode The execution mode.
 * @param syncFn Function returning sync iterable.
 * @param asyncFn Function returning async iterable.
 * @returns The iterable with correct mode wrapping.
 * @internal
 * @since 0.10.0
 */
export function dispatchIterableByMode<M extends Mode, T>(
  mode: M,
  syncFn: () => Iterable<T>,
  asyncFn: () => AsyncIterable<T>,
): ModeIterable<M, T> {
  if (mode === "async") {
    return asyncFn() as ModeIterable<M, T>;
  }
  return syncFn() as ModeIterable<M, T>;
}
