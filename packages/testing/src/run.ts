/**
 * Helpers that capture `run()` and `runAsync()` executions.
 *
 * @module
 * @since 1.3.0
 */
import type { SourceContext } from "@optique/core/context";
import type { ContextOptionsParam } from "@optique/core/facade";
import type { InferValue, Mode, Parser } from "@optique/core/parser";
import type { Program } from "@optique/core/program";
import { runAsync, type RunOptions } from "@optique/run";
import type { CapturedOutput } from "./index.ts";

/**
 * Options for {@link captureRun}.
 *
 * These are the options accepted by `runAsync()`, except for the output and
 * exit callbacks controlled by the capture helper.
 *
 * @since 1.3.0
 */
export type CaptureRunOptions =
  & Omit<RunOptions, "stdout" | "stderr" | "onExit">
  & {
    readonly stdout?: never;
    readonly stderr?: never;
    readonly onExit?: never;
  };

/**
 * The result of an in-process runner execution.
 *
 * A normal parser return includes its inferred value.  Help, version,
 * completion, and parse-error exits instead include the requested exit code.
 * Both variants preserve the output written through the runner callbacks.
 *
 * @template T The inferred parser value type.
 * @since 1.3.0
 */
export type CapturedRunResult<T> =
  & CapturedOutput
  & (
    | {
      readonly kind: "returned";
      readonly value: T;
      readonly exitCode: 0;
    }
    | {
      readonly kind: "exited";
      readonly exitCode: number;
    }
  );

type RejectEmptyContexts<TContexts extends readonly SourceContext<unknown>[]> =
  TContexts extends readonly [] ? never
    : unknown;

type ContextsFromOptions<TOptions> = [Exclude<TOptions, undefined>] extends
  [never] ? undefined
  : Exclude<TOptions, undefined> extends {
    readonly contexts?: infer TContexts extends
      | readonly SourceContext<unknown>[]
      | undefined;
  } ? TContexts
  : undefined;

type RejectContextfulOptions<TOptions> = [ContextsFromOptions<TOptions>] extends
  [undefined | readonly []] ? unknown
  : never;

type RejectUnknownCaptureRunOptionKeys<TOptions> = [TOptions] extends
  [undefined] ? unknown
  : Exclude<keyof TOptions, keyof CaptureRunOptions> extends never ? unknown
  : never;

type AcceptExactCaptureRunOptions<TOptions> = [TOptions] extends
  [CaptureRunOptions] ? [CaptureRunOptions] extends [TOptions] ? unknown
  : never
  : never;

type AcceptExactOptionalCaptureRunOptions<TOptions> = [TOptions] extends
  [CaptureRunOptions | undefined]
  ? [CaptureRunOptions | undefined] extends [TOptions] ? unknown
  : never
  : never;

/**
 * Runs a parser or program in process and captures runner-controlled output.
 *
 * The helper always returns a promise.  Parser returns become `returned`
 * results, while intentional help, version, completion, and parse-error exits
 * become `exited` results.  Writes that bypass the injected callbacks, such as
 * `console.log()` or direct process-stream writes, are not captured.
 * `colors` and `maxWidth` retain `runAsync()`'s terminal-dependent defaults,
 * so set both explicitly when asserting rendered text.
 *
 * @template T The parser or program result type.
 * @param parser The parser or `Program` to execute.
 * @param options Runner options other than the captured callbacks.
 * @returns A promise resolving to the returned value or intentional exit,
 *          together with captured standard output and standard error.
 * @throws Any unexpected parser, context, callback, or disposal error.  Promise
 *         rejections from asynchronous parsers and contexts also propagate.
 * @since 1.3.0
 */
export function captureRun<
  T extends Parser<Mode, unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
>(
  parser: T,
  options:
    & CaptureRunOptions
    & { readonly contexts: TContexts }
    & ContextOptionsParam<TContexts, InferValue<T>>,
): Promise<CapturedRunResult<InferValue<T>>>;

export function captureRun<
  M extends Mode,
  T,
  const TContexts extends readonly SourceContext<unknown>[],
>(
  program: Program<M, T>,
  options:
    & CaptureRunOptions
    & { readonly contexts: TContexts }
    & RejectEmptyContexts<TContexts>
    & ContextOptionsParam<TContexts, T>,
): Promise<CapturedRunResult<T>>;

export function captureRun<
  T,
  const TOptions extends CaptureRunOptions | undefined,
>(
  program: Program<"sync", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownCaptureRunOptionKeys<TOptions>,
): Promise<CapturedRunResult<T>>;

export function captureRun<
  T,
  const TOptions extends CaptureRunOptions | undefined,
>(
  program: Program<"async", T>,
  options?:
    & TOptions
    & RejectContextfulOptions<TOptions>
    & RejectUnknownCaptureRunOptionKeys<TOptions>,
): Promise<CapturedRunResult<T>>;

export function captureRun<T, TOptions extends CaptureRunOptions>(
  program: Program<Mode, T>,
  options: TOptions & AcceptExactCaptureRunOptions<TOptions>,
): Promise<CapturedRunResult<T>>;

export function captureRun<
  T,
  TOptions extends CaptureRunOptions | undefined,
>(
  program: Program<Mode, T>,
  options: TOptions & AcceptExactOptionalCaptureRunOptions<TOptions>,
): Promise<CapturedRunResult<T>>;

export function captureRun<T extends Parser<Mode, unknown, unknown>>(
  parser: T,
  options?: CaptureRunOptions,
): Promise<CapturedRunResult<InferValue<T>>>;

export async function captureRun(
  parserOrProgram:
    | Parser<Mode, unknown, unknown>
    | Program<Mode, unknown>,
  options: CaptureRunOptions = {},
): Promise<CapturedRunResult<unknown>> {
  let stdout = "";
  let stderr = "";
  const runOptions: RunOptions = {
    ...options,
    stdout(text) {
      stdout += `${text}\n`;
    },
    stderr(text) {
      stderr += `${text}\n`;
    },
    onExit(exitCode): never {
      throw new CapturedExit(exitCode);
    },
  };

  try {
    const value = "parser" in parserOrProgram &&
        "metadata" in parserOrProgram
      ? await runAsync(parserOrProgram, runOptions)
      : await runAsync(parserOrProgram, runOptions);
    return {
      kind: "returned",
      value,
      exitCode: 0,
      stdout,
      stderr,
    };
  } catch (error) {
    if (!(error instanceof CapturedExit)) throw error;
    return {
      kind: "exited",
      exitCode: error.exitCode,
      stdout,
      stderr,
    };
  }
}

class CapturedExit extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`Runner exited with code ${exitCode}.`);
    this.name = "CapturedExit";
    this.exitCode = exitCode;
  }
}
