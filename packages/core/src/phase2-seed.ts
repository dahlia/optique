import { unwrapInjectedAnnotationWrapper } from "./annotations.ts";
import { dispatchByMode } from "./mode-dispatch.ts";
import type { ExecutionContext, Mode, ModeValue, Parser } from "./parser.ts";
import type { DeferredMap, ValueParserResult } from "./valueparser.ts";

/**
 * Best-effort parser value used for phase-two context collection.
 *
 * @internal
 */
export interface Phase2Seed<T = unknown> {
  readonly value: T;
  readonly deferred?: true;
  readonly deferredKeys?: DeferredMap;
}

/**
 * Internal hook for extracting a best-effort phase-two seed from parser state.
 *
 * @internal
 */
export type Phase2SeedExtractor<
  M extends Mode = Mode,
  TState = unknown,
  TValue = unknown,
> = (
  state: TState,
  exec?: ExecutionContext,
) => ModeValue<M, Phase2Seed<TValue> | null>;

/**
 * Internal parser hook key for phase-two seed extraction.
 *
 * @internal
 */
export const extractPhase2SeedKey: unique symbol = Symbol(
  "@optique/core/extractPhase2Seed",
);

/**
 * Converts a successful complete() result into a phase-two seed.
 *
 * @internal
 */
export function phase2SeedFromValueResult<T>(
  result: Extract<ValueParserResult<T>, { readonly success: true }>,
): Phase2Seed<T> {
  return {
    value: unwrapInjectedAnnotationWrapper(result.value),
    ...(result.deferred ? { deferred: true as const } : {}),
    ...(result.deferredKeys != null
      ? { deferredKeys: result.deferredKeys }
      : {}),
  };
}

/**
 * Invokes a parser's internal phase-two seed hook when present.
 *
 * @internal
 */
export function extractPhase2Seed<
  M extends Mode,
  TValue,
  TState,
>(
  parser: Parser<M, TValue, TState>,
  state: TState,
  exec?: ExecutionContext,
): ModeValue<M, Phase2Seed<TValue> | null> {
  return dispatchByMode(
    parser.$mode,
    () => {
      const extractor = (parser as Parser<"sync", TValue, TState> & {
        readonly [extractPhase2SeedKey]?: Phase2SeedExtractor<
          "sync",
          TState,
          TValue
        >;
      })[extractPhase2SeedKey];
      return extractor == null ? null : extractor(state, exec);
    },
    async () => {
      const extractor = (parser as Parser<"async", TValue, TState> & {
        readonly [extractPhase2SeedKey]?: Phase2SeedExtractor<
          "async",
          TState,
          TValue
        >;
      })[extractPhase2SeedKey];
      return extractor == null ? null : await extractor(state, exec);
    },
  );
}

/**
 * Attempts to complete a parser and falls back to the internal phase-two
 * seed hook when completion fails or throws.
 *
 * @internal
 */
export function completeOrExtractPhase2Seed<
  M extends Mode,
  TValue,
  TState,
>(
  parser: Parser<M, TValue, TState>,
  state: TState,
  exec?: ExecutionContext,
): ModeValue<M, Phase2Seed<TValue> | null> {
  return dispatchByMode(
    parser.$mode,
    () => {
      try {
        const result = (parser as Parser<"sync", TValue, TState>).complete(
          state,
          exec,
        );
        if (result.success) {
          return phase2SeedFromValueResult(result);
        }
      } catch {
        // Fall back to the best-effort extraction hook below.
      }
      return extractPhase2Seed(
        parser as Parser<"sync", TValue, TState>,
        state,
        exec,
      );
    },
    async () => {
      try {
        const result = await (
          parser as Parser<"async", TValue, TState>
        ).complete(state, exec);
        if (result.success) {
          return phase2SeedFromValueResult(result);
        }
      } catch {
        // Fall back to the best-effort extraction hook below.
      }
      return await extractPhase2Seed(
        parser as Parser<"async", TValue, TState>,
        state,
        exec,
      );
    },
  );
}
