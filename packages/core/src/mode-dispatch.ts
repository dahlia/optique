/**
 * Internal helpers for mode-based dispatch.
 *
 * This module contains utilities for handling sync/async mode dispatch
 * in a type-safe way. The type assertions in this file are necessary
 * due to TypeScript's limitation in narrowing conditional types based
 * on runtime checks.
 *
 * @internal
 * @since 0.10.0
 */

import type { Mode, ModeIterable, ModeValue } from "./parser.ts";

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
 * @internal
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
 * Maps a mode-wrapped value while preserving its execution mode.
 *
 * @param mode The execution mode.
 * @param value The mode-wrapped value to transform.
 * @param mapFn Mapping function applied to the unwrapped value.
 * @returns The mapped value with correct mode wrapping.
 * @internal
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
  return mapFn(value as T) as ModeValue<M, U>;
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
