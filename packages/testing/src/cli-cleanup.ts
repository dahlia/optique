/** Internal failure cleanup for real CLI processes. */
import { spawn } from "node:child_process";
import { win32 } from "node:path";
import process from "node:process";
import type { CliProcess } from "./cli-process.ts";

/** A monotonic clock whose scheduled callbacks run after the current stack. */
export interface CleanupClock {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delay: number) => () => void;
}

/** Invocation-local waits, notified by process and stream lifecycle events. */
export interface CleanupWaiter {
  readonly now: () => number;
  readonly notify: () => void;
  readonly waitFor: (
    predicate: () => boolean,
    deadline: number,
  ) => Promise<boolean>;
  readonly observeClose: () => Promise<void>;
  readonly dispose: () => void;
}

const systemClock: CleanupClock = {
  now: () => performance.now(),
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
};

/**
 * Creates deadline waits driven by a monotonic clock and lifecycle notifications.
 * @param clock The clock and cancellable timer scheduler.
 * @returns A waiter that owns and disposes its outstanding timers.
 */
export function createCleanupWaiter(
  clock: CleanupClock = systemClock,
): CleanupWaiter {
  const pending = new Set<{
    readonly wake: () => void;
    readonly finish: (value: boolean) => void;
  }>();
  let disposed = false;
  return {
    now: () => clock.now(),
    notify() {
      for (const wait of [...pending]) wait.wake();
    },
    waitFor(predicate, deadline) {
      if (predicate()) return Promise.resolve(true);
      if (disposed || deadline <= clock.now()) return Promise.resolve(false);
      return new Promise((resolve) => {
        let cancel = () => {};
        let finished = false;
        const wait = {
          wake() {
            if (predicate()) wait.finish(true);
          },
          finish(value: boolean) {
            if (finished) return;
            finished = true;
            cancel();
            pending.delete(wait);
            resolve(value);
          },
        };
        pending.add(wait);
        cancel = clock.schedule(
          () => wait.finish(false),
          Math.max(0, deadline - clock.now()),
        );
      });
    },
    async observeClose() {
      await Promise.resolve();
      if (disposed) return;
      await new Promise<void>((resolve) => {
        let cancel = () => {};
        const wait = {
          wake() {},
          finish() {
            cancel();
            pending.delete(wait);
            resolve();
          },
        };
        pending.add(wait);
        cancel = clock.schedule(() => wait.finish(), 0);
      });
    },
    dispose() {
      disposed = true;
      for (const wait of [...pending]) wait.finish(false);
    },
  };
}

/** Live target lifecycle state, read again for each wait and PID guard. */
export interface CleanupState {
  readonly exited: boolean;
  readonly closed: boolean;
  readonly stdinClosed: boolean;
  readonly stdoutClosed: boolean;
  readonly stderrClosed: boolean;
}

/** The invocation-owned state and ordered error collector used during cleanup. */
export interface CleanupContext {
  readonly child: CliProcess | undefined;
  readonly mode: "child" | "tree";
  readonly getState: () => CleanupState;
  readonly waiter: CleanupWaiter;
  readonly recordError: (error: unknown) => void;
}

/** Internal process operations; overrides belong to tests and measurements only. */
export interface CleanupDependencies {
  readonly platform?: NodeJS.Platform;
  readonly systemRoot?: () => string | undefined;
  readonly spawnHelper?: (
    command: string,
    args: readonly string[],
  ) => CliProcess;
  readonly signalGroup?: (pid: number, signal: NodeJS.Signals | 0) => void;
  readonly budget?: number;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

/**
 * Terminates a failed invocation and closes its owned process streams.
 * @param context Live invocation state and cleanup error sink.
 * @param dependencies Internal platform operations and measurement overrides.
 * @returns Completion after bounded cleanup attempts.
 */
export async function cleanupCliProcess(
  context: CleanupContext,
  dependencies: CleanupDependencies = {},
): Promise<void> {
  const { child, getState, waiter } = context;
  if (child === undefined) return;
  const platform = dependencies.platform ?? process.platform;
  const deadline = waiter.now() + (dependencies.budget ?? 2000);
  let active = true;
  let helper: CliProcess | undefined;
  let helperClosed = false;
  let helperExited = false;
  let helperFailed = false;
  let helperSpawned = false;
  let helperCode: number | null = null;
  let diagnostic = "";

  function record(stage: string, cause?: unknown) {
    if (!active) return;
    context.recordError(new Error(stage, { cause }));
  }
  function attempt(stage: string, action: () => void) {
    try {
      action();
    } catch (error) {
      record(stage, error);
    }
  }
  function killChild(signal: NodeJS.Signals) {
    if (child?.pid === undefined || getState().exited || getState().closed) {
      return;
    }
    attempt("The CLI process could not be signaled during cleanup.", () => {
      child.kill(signal);
    });
  }
  function groupSignal(signal: NodeJS.Signals | 0): boolean {
    if (child?.pid === undefined) return false;
    try {
      if (dependencies.signalGroup !== undefined) {
        dependencies.signalGroup(-child.pid, signal);
      } else process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (errorCode(error) !== "ESRCH") {
        record(
          "The CLI process group could not be signaled during cleanup.",
          error,
        );
      }
      return false;
    }
  }
  function destroyStreams(target: CliProcess, name: string) {
    for (const stream of ["stdin", "stdout", "stderr"] as const) {
      attempt(`${name} ${stream} could not be closed during cleanup.`, () => {
        target[stream].destroy();
      });
    }
  }
  function retireHelper() {
    const target = helper;
    if (target === undefined) return;
    if (!helperExited && !helperClosed) {
      attempt("The tree cleanup command could not be terminated.", () => {
        target.kill("SIGKILL");
      });
    }
    destroyStreams(target, "Tree cleanup command");
  }
  async function taskkill(pid: number) {
    const root = dependencies.systemRoot?.() ??
      (dependencies.systemRoot === undefined
        ? process.env.SystemRoot ?? process.env.windir
        : undefined);
    if (root === undefined || !win32.isAbsolute(root)) {
      record("Windows system directory is unavailable for tree cleanup.");
      killChild("SIGKILL");
      return;
    }
    try {
      const command = win32.join(root, "System32", "taskkill.exe");
      const args = ["/PID", String(pid), "/T", "/F"];
      helper = dependencies.spawnHelper?.(command, args) ??
        spawn(command, args, {
          shell: false,
          windowsHide: true,
          stdio: "pipe",
        });
    } catch (error) {
      record("The tree cleanup command could not be launched.", error);
      killChild("SIGKILL");
      return;
    }
    helper.on("spawn", () => {
      helperSpawned = true;
    });
    helper.on("exit", () => {
      helperExited = true;
      waiter.notify();
    });
    helper.on("close", (code: number | null) => {
      helperClosed = true;
      helperCode = code;
      waiter.notify();
    });
    helper.on("error", (error: unknown) => {
      helperFailed = true;
      record(
        helperSpawned
          ? "The tree cleanup command failed."
          : "The tree cleanup command could not be launched.",
        error,
      );
      waiter.notify();
    });
    // The helper receives no input.  Keep an error listener for a failed spawn.
    helper.stdin.on("error", () => {});
    helper.stdout.on("error", (error: unknown) => {
      record("Tree cleanup command stdout could not be read.", error);
    });
    helper.stderr.on("error", (error: unknown) => {
      record("Tree cleanup command stderr could not be read.", error);
    });
    helper.stderr.setEncoding("utf8");
    helper.stderr.on("data", (text: string) => {
      if (active) diagnostic += text;
    });
    helper.stdout.resume();
    helper.stdin.end();
    const completed = await waiter.waitFor(
      () => helperClosed || helperFailed,
      deadline,
    );
    if (!completed) {
      // This verdict is permanent even if forced retirement later emits close.
      record("The tree cleanup command timed out.");
      retireHelper();
      killChild("SIGKILL");
    } else if (helperFailed) {
      retireHelper();
      killChild("SIGKILL");
    } else if (helperCode !== 0) {
      record(
        `Tree cleanup command exited with code ${helperCode}: ${diagnostic}`,
      );
      killChild("SIGKILL");
    }
  }
  const exited = () => getState().exited || getState().closed;
  const targetClosed = () => {
    const state = getState();
    return state.closed && state.stdinClosed && state.stdoutClosed &&
      state.stderrClosed;
  };
  const allClosed = () =>
    targetClosed() &&
    (helper === undefined || helperClosed);
  try {
    attempt("CLI stdin could not be closed during cleanup.", () => {
      child.stdin.destroy();
    });
    if (child.pid !== undefined) {
      if (platform === "win32") {
        if (context.mode === "tree") {
          if (exited()) {
            record("Cannot trace a Windows process tree after its root exits.");
          } else await taskkill(child.pid);
        } else killChild("SIGKILL");
      } else if (context.mode === "tree") {
        const found = groupSignal("SIGTERM");
        if (!found && !exited()) {
          record("The child process group is unavailable.");
        }
        killChild("SIGTERM");
        if (
          found && !await waiter.waitFor(
            () => exited() && !groupSignal(0),
            Math.min(deadline, waiter.now() + 1000),
          )
        ) groupSignal("SIGKILL");
        killChild("SIGKILL");
      } else {
        killChild("SIGTERM");
        if (
          !await waiter.waitFor(exited, Math.min(deadline, waiter.now() + 1000))
        ) {
          killChild("SIGKILL");
        }
      }
    }
    if (!await waiter.waitFor(exited, deadline)) {
      record("The CLI process did not exit during cleanup.");
      killChild("SIGKILL");
    }
    // Exit can precede the last reads, or descendants can keep pipes open.
    await waiter.waitFor(
      () => getState().closed,
      Math.min(deadline, waiter.now() + 250),
    );
  } catch (error) {
    record("Process termination failed during cleanup.", error);
    retireHelper();
    killChild("SIGKILL");
  }
  destroyStreams(child, "CLI process");
  if (!await waiter.waitFor(allClosed, deadline)) {
    // destroy() can enqueue local close events after the deadline. Observe one
    // turn collectively, without granting a new positive-duration grace period.
    await waiter.observeClose();
  }
  if (helper !== undefined && !helperClosed) {
    record("The tree cleanup command did not close.");
    attempt("The tree cleanup command could not be unreferenced.", () => {
      helper?.unref();
    });
  }
  if (!targetClosed()) {
    record("The CLI process streams did not close during cleanup.");
    attempt("The CLI process could not be unreferenced during cleanup.", () => {
      child.unref();
    });
  }
  active = false;
}
