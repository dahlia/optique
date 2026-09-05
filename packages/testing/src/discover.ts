/**
 * Helpers that capture `runProgram()` executions, including command discovery,
 * lifecycle hooks, and handler dispatch.
 *
 * @module
 * @since 1.3.0
 */
import { runProgram, type RunProgramOptions } from "@optique/discover";
import type { CapturedOutput } from "./index.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K>
  : never;

/**
 * Options for {@link captureProgramRun}, preserving the command source union
 * and program hook resource type of `RunProgramOptions`.
 *
 * Output and exit callbacks are controlled by the capture helper.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @since 1.3.0
 */
export type CaptureProgramRunOptions<R = unknown> =
  & DistributiveOmit<RunProgramOptions<R>, "stdout" | "stderr" | "onExit">
  & {
    readonly stdout?: never;
    readonly stderr?: never;
    readonly onExit?: never;
  };

/**
 * Captured output and exit code from a command program execution.
 *
 * @since 1.3.0
 */
export interface ProgramRunResult extends CapturedOutput {
  /**
   * Zero after normal completion, or the code requested by an intentional exit.
   */
  readonly exitCode: number;
}

/**
 * Runs a command program in process and captures Optique-controlled output.
 *
 * Discovery, hooks, and command handlers execute normally.  Help, version,
 * completion, and parse-error exits become results; other errors continue to
 * reject as they do in `runProgram()`.  Writes through `console.log()`,
 * `print()`, or process streams bypass the injected callbacks and are not
 * captured.  Each callback write includes the default writer's trailing newline.
 *
 * Options retain `runProgram()`'s defaults, including process arguments and
 * terminal-dependent colors and width.  Set `args`, `colors`, and `maxWidth`
 * explicitly for deterministic tests.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @param options Program options other than the captured callbacks.
 * @returns Captured output and the exit code after execution completes.
 * @throws Any error propagated by `runProgram()`, including discovery, parser,
 *         hook, handler, callback, and context disposal failures.
 * @since 1.3.0
 */
export async function captureProgramRun<R = unknown>(
  options: CaptureProgramRunOptions<R>,
): Promise<ProgramRunResult> {
  // A disposal failure can expose an exit through SuppressedError.suppressed.
  // A separate class per call prevents a rethrown exit from another invocation
  // from being mistaken for this invocation's intentional exit.
  class ProgramExit extends Error {
    readonly exitCode: number;

    constructor(exitCode: number) {
      super(`Program exited with code ${exitCode}.`);
      this.name = "ProgramExit";
      this.exitCode = exitCode;
    }
  }

  let stdout = "";
  let stderr = "";
  const runOptions: RunProgramOptions<R> = {
    ...options,
    stdout(text) {
      stdout += `${text}\n`;
    },
    stderr(text) {
      stderr += `${text}\n`;
    },
    onExit(exitCode): never {
      throw new ProgramExit(exitCode);
    },
  };

  try {
    await runProgram<R>(runOptions);
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    if (!(error instanceof ProgramExit)) throw error;
    return { exitCode: error.exitCode, stdout, stderr };
  }
}
