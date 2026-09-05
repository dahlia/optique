/**
 * Helpers that invoke real CLI entry points in child processes.
 *
 * @module
 * @since 1.3.0
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { CapturedOutput } from "./index.ts";
import { type CliProcess, spawnCliProcess } from "./cli-process.ts";

interface ProcessOptions {
  /** Working directory, relative to the runner's original base directory. */
  readonly cwd?: string | URL;
  /**
   * Environment overrides.  Undefined omits the variable from the supplied
   * environment; the runtime or operating system may restore system variables.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Milliseconds including output collection; defaults to 5000.  Zero disables. */
  readonly timeout?: number;
  /** Cancellation signal, replacing the runner's default when supplied. */
  readonly signal?: AbortSignal;
  /** Failure cleanup target; defaults to the directly launched child. */
  readonly cleanup?: "child" | "tree";
}

/**
 * A current-runtime entry point or an explicit executable and fixed arguments.
 * Relative entry points are resolved once against the factory's working
 * directory.  Runtime arguments and permissions are never inherited implicitly.
 *
 * @since 1.3.0
 */
export type CliRunnerOptions =
  & ProcessOptions
  & (
    | {
      /** File path or file URL to execute with the current runtime. */
      readonly entrypoint: string | URL;
      /** Runtime flags before the entry point; Deno flags follow `run`. */
      readonly runtimeArgs?: readonly string[];
      readonly command?: never;
    }
    | {
      /** Executable followed by fixed arguments, passed without a shell. */
      readonly command: readonly [string, ...string[]];
      readonly entrypoint?: never;
      readonly runtimeArgs?: never;
    }
  );

/**
 * Inputs and default overrides for one CLI invocation.
 *
 * @since 1.3.0
 */
export interface CliInvocationOptions extends ProcessOptions {
  /** Arguments appended verbatim to the runner's command. */
  readonly args?: readonly string[];
  /** UTF-8 input.  The input pipe is closed even when this is omitted. */
  readonly stdin?: string;
}

/**
 * Complete captured output and the runtime's reported process status.
 * Nonzero exit codes and external signal termination are results, not errors.
 *
 * @since 1.3.0
 */
export interface CliResult extends CapturedOutput {
  /** Exit code, or null when the process terminated through a signal. */
  readonly exitCode: number | null;
  /** Terminating signal, or null; reporting depends on the OS and runtime. */
  readonly signal: string | null;
}

/**
 * A failure of the invocation harness, with partial output and observed status.
 * Cleanup failures retain the original failure and cleanup errors in an
 * `AggregateError` cause.  A status can be null when no exit was observed.
 *
 * @since 1.3.0
 */
export class CliInvocationError extends Error implements CliResult {
  /** Whether launching, waiting, cancellation, I/O, or cleanup failed. */
  readonly reason: "spawn" | "timeout" | "aborted" | "io" | "cleanup";
  /** Standard output collected before the invocation finished cleaning up. */
  readonly stdout: string;
  /** Standard error collected before the invocation finished cleaning up. */
  readonly stderr: string;
  /** Observed exit code, including during cleanup, or null. */
  readonly exitCode: number | null;
  /** Observed terminating signal, including during cleanup, or null. */
  readonly signal: string | null;

  /**
   * Constructs a harness failure from its captured state.
   * @param reason The stage that failed.
   * @param message A description of the failure.
   * @param result Captured text and observed process status.
   * @param options The underlying cause, if any.
   */
  constructor(
    reason: CliInvocationError["reason"],
    message: string,
    result: CliResult,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CliInvocationError";
    this.reason = reason;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.exitCode = result.exitCode;
    this.signal = result.signal;
  }
}

/**
 * A reusable runner whose invocations have independent process state.
 *
 * @since 1.3.0
 */
export interface CliRunner {
  /**
   * Invokes the CLI with positional arguments or explicit process inputs.
   * @param args Arguments to append, or invocation options.
   * @returns Exact output and process status after all output has been read.
   * @throws {TypeError} If invocation options have an invalid shape.
   * @throws {RangeError} If the timeout is outside its supported range.
   * @throws {CliInvocationError} If starting, capturing, or cleaning up fails.
   */
  readonly invoke: {
    (...args: readonly string[]): Promise<CliResult>;
    (options: CliInvocationOptions): Promise<CliResult>;
  };
}

const emptyResult: CliResult = {
  stdout: "",
  stderr: "",
  exitCode: null,
  signal: null,
};

function filePath(value: string | URL): string {
  if (value instanceof URL) return fileURLToPath(value);
  if (typeof value !== "string") {
    throw new TypeError("Expected a file path or URL.");
  }
  return value;
}

function strings(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError("Expected an array of strings.");
  }
  return [...value];
}

function validate(options: ProcessOptions): void {
  if (
    options == null || typeof options !== "object" || Array.isArray(options)
  ) {
    throw new TypeError("Expected process options.");
  }
  if (
    options.timeout !== undefined &&
    (!Number.isInteger(options.timeout) || options.timeout < 0 ||
      options.timeout > 2_147_483_647)
  ) {
    throw new RangeError(
      "Timeout must be an integer between 0 and 2147483647.",
    );
  }
  if (
    options.cleanup !== undefined && options.cleanup !== "child" &&
    options.cleanup !== "tree"
  ) {
    throw new TypeError("Cleanup must be child or tree.");
  }
  if (options.cwd !== undefined) filePath(options.cwd);
  if (
    options.env !== undefined && (options.env === null ||
      typeof options.env !== "object" || Array.isArray(options.env) ||
      Object.values(options.env).some((v) =>
        v !== undefined && typeof v !== "string"
      ))
  ) {
    throw new TypeError("Environment values must be strings or undefined.");
  }
  if (
    options.signal !== undefined && (options.signal == null ||
      typeof options.signal.aborted !== "boolean" ||
      typeof options.signal.addEventListener !== "function" ||
      typeof options.signal.removeEventListener !== "function")
  ) {
    throw new TypeError("Expected an AbortSignal.");
  }
}

function environment(
  ...layers:
    readonly (Readonly<Record<string, string | undefined>> | undefined)[]
): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const names = new Map<string, string>();
  for (const layer of layers) {
    if (layer === undefined) continue;
    for (const [name, value] of Object.entries(layer)) {
      const key = process.platform === "win32" ? name.toUpperCase() : name;
      const previous = names.get(key);
      if (previous !== undefined) delete result[previous];
      names.set(key, name);
      if (value !== undefined) result[name] = value;
    }
  }
  return result;
}

/**
 * Creates a runner for a real CLI without building or installing its target.
 *
 * Output is UTF-8 text, kept separate and unmodified.  The default timeout is
 * five seconds, including output collection; zero waits indefinitely unless
 * aborted.  Failure cleanup targets the child by default, or its ordinary
 * process tree when requested.  Tree cleanup uses POSIX groups or Windows
 * taskkill and cannot contain escaped or already-orphaned descendants.  Normal
 * completion does not sweep descendants.  Abrupt termination of the test
 * process itself is outside this cleanup contract.
 *
 * Deno callers must grant the harness read, environment, and subprocess
 * permissions.  Child permissions belong in `runtimeArgs`.  No color settings,
 * runtime flags, or parent `execArgv` are injected.
 *
 * @param options An entry point or command and invocation defaults.
 * @returns A reusable runner with isolated invocations.
 * @throws {TypeError} If the command, paths, or options are invalid.
 * @throws {RangeError} If the timeout is outside its supported range.
 * @throws If reading the factory's working directory is not permitted.
 * @since 1.3.0
 */
export function createCliRunner(options: CliRunnerOptions): CliRunner {
  validate(options);
  const hasCommand = options.command !== undefined;
  if (
    hasCommand === (options.entrypoint !== undefined) ||
    (hasCommand && options.runtimeArgs !== undefined)
  ) {
    throw new TypeError("Specify either an entrypoint or a command.");
  }
  const base = resolve(
    options.cwd === undefined ? process.cwd() : filePath(options.cwd),
  );
  let fixed: readonly string[] | undefined;
  let entrypoint: string | undefined;
  if (options.command !== undefined) {
    fixed = strings(options.command);
    if (fixed.length === 0 || fixed[0].length === 0) {
      throw new TypeError("Command must contain a nonempty executable.");
    }
  } else {
    entrypoint = resolve(base, filePath(options.entrypoint));
  }
  const runtimeArgs = strings(options.runtimeArgs ?? []);
  const defaults = {
    timeout: options.timeout ?? 5000,
    signal: options.signal,
    cleanup: options.cleanup ?? "child",
    env: options.env === undefined ? undefined : { ...options.env },
  };

  async function invoke(...args: readonly string[]): Promise<CliResult>;
  async function invoke(options: CliInvocationOptions): Promise<CliResult>;
  async function invoke(
    ...input: readonly (string | CliInvocationOptions)[]
  ): Promise<CliResult> {
    let call: CliInvocationOptions;
    if (input.length === 1 && typeof input[0] === "object") {
      call = input[0];
    } else {
      const args: string[] = [];
      for (const item of input) {
        if (typeof item !== "string") {
          throw new TypeError("Arguments must be strings.");
        }
        args.push(item);
      }
      call = { args };
    }
    validate(call);
    const args = strings(call.args ?? []);
    if (call.stdin !== undefined && typeof call.stdin !== "string") {
      throw new TypeError("Stdin must be a string.");
    }
    const signal = call.signal ?? defaults.signal;
    if (signal?.aborted) {
      throw new CliInvocationError(
        "aborted",
        "CLI invocation was aborted.",
        emptyResult,
        { cause: signal.reason },
      );
    }
    try {
      const command = fixed ?? [
        process.execPath,
        ...("Deno" in globalThis ? ["run"] : []),
        ...runtimeArgs,
        // The exclusive factory union guarantees an entry point here.
        ...(entrypoint === undefined ? [] : [entrypoint]),
      ];
      return await runProcess(command[0], [...command.slice(1), ...args], {
        cwd: call.cwd === undefined ? base : resolve(base, filePath(call.cwd)),
        env: environment(process.env, defaults.env, call.env),
        timeout: call.timeout ?? defaults.timeout,
        cleanup: call.cleanup ?? defaults.cleanup,
        signal,
        stdin: call.stdin ?? "",
      });
    } catch (cause) {
      if (cause instanceof CliInvocationError) throw cause;
      throw new CliInvocationError(
        "spawn",
        "Could not start the CLI.",
        emptyResult,
        { cause },
      );
    }
  }
  return Object.freeze({ invoke });
}

interface ExecutionOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly timeout: number;
  readonly cleanup: "child" | "tree";
  readonly signal: AbortSignal | undefined;
  readonly stdin: string;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

function runProcess(
  command: string,
  args: readonly string[],
  options: ExecutionOptions,
): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    let child: CliProcess | undefined;
    let spawned = false;
    let exited = false;
    let closed = false;
    let outEnd = false;
    let errEnd = false;
    let outClose = false;
    let errClose = false;
    let inClose = false;
    let exitCode: number | null = null;
    let signal: string | null = null;
    const stdout: string[] = [];
    const stderr: string[] = [];
    let settled = false;
    let failure: {
      readonly reason: CliInvocationError["reason"];
      readonly message: string;
      readonly cause?: unknown;
    } | undefined;
    const cleanupErrors: unknown[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waiters = new Set<() => void>();
    const snapshot = (): CliResult => ({
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode,
      signal,
    });
    const onAbort = () =>
      fail("aborted", "CLI invocation was aborted.", options.signal?.reason);
    const clearInvocation = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    function release() {
      clearInvocation();
      child?.stdout.removeListener("data", onOut);
      child?.stderr.removeListener("data", onErr);
      // Error listeners remain until close, including after a cleanup deadline.
      if (closed) child?.removeListener("error", onError);
      if (outClose) child?.stdout.removeListener("error", onIoError);
      if (errClose) child?.stderr.removeListener("error", onIoError);
      if (inClose) child?.stdin.removeListener("error", onInputError);
    }
    function update() {
      for (const wake of [...waiters]) wake();
      if (settled) {
        release();
        return;
      }
      if (
        !failure && exited && closed && outEnd && errEnd && outClose &&
        errClose && inClose
      ) {
        settled = true;
        release();
        resolveResult(snapshot());
      }
    }
    function waitFor(
      predicate: () => boolean,
      milliseconds: number,
    ): Promise<boolean> {
      if (predicate()) return Promise.resolve(true);
      return new Promise((done) => {
        const finish = (value: boolean) => {
          clearTimeout(timeout);
          waiters.delete(wake);
          done(value);
        };
        const wake = () => {
          if (predicate()) finish(true);
        };
        const timeout = setTimeout(
          () => finish(false),
          Math.max(0, milliseconds),
        );
        waiters.add(wake);
      });
    }
    function fail(
      reason: CliInvocationError["reason"],
      message: string,
      cause?: unknown,
    ) {
      if (failure || settled) return;
      failure = { reason, message, cause };
      clearInvocation();
      // Let spawn finish assigning its handle before starting cleanup.
      queueMicrotask(() => {
        void cleanup();
      });
    }
    function killChild(kind: NodeJS.Signals) {
      if (!child?.pid || exited || closed) return;
      try {
        child.kill(kind);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    function groupSignal(kind: NodeJS.Signals | 0): boolean {
      if (!child?.pid) return false;
      try {
        process.kill(-child.pid, kind);
        return true;
      } catch (error) {
        if (errorCode(error) !== "ESRCH") cleanupErrors.push(error);
        return false;
      }
    }
    async function taskkill(deadline: number) {
      let helper: ChildProcessWithoutNullStreams;
      const root = process.env.SystemRoot ?? process.env.windir;
      if (root === undefined || !isAbsolute(root)) {
        cleanupErrors.push(
          new Error("Windows system directory is unavailable."),
        );
        killChild("SIGKILL");
        return;
      }
      try {
        helper = spawn(join(root, "System32", "taskkill.exe"), [
          "/PID",
          String(child?.pid),
          "/T",
          "/F",
        ], {
          shell: false,
          windowsHide: true,
          stdio: "pipe",
        });
      } catch (error) {
        cleanupErrors.push(error);
        killChild("SIGKILL");
        return;
      }
      let helperClosed = false;
      let helperError: unknown;
      let helperCode: number | null = null;
      let diagnostic = "";
      helper.stdout.resume();
      helper.stderr.setEncoding("utf8");
      helper.stderr.on("data", (text: string) => {
        diagnostic += text;
      });
      helper.stdin.on("error", () => {});
      helper.stdout.on("error", (error) => {
        helperError = error;
      });
      helper.stderr.on("error", (error) => {
        helperError = error;
      });
      helper.on("error", (error) => {
        helperError = error;
        killChild("SIGKILL");
      });
      helper.on("close", (code) => {
        helperClosed = true;
        helperCode = code;
        update();
      });
      helper.stdin.end();
      if (
        !await waitFor(
          () => helperClosed,
          Math.min(1000, deadline - Date.now()),
        )
      ) {
        cleanupErrors.push(new Error("Tree cleanup command timed out."));
        try {
          helper.kill("SIGKILL");
        } catch (error) {
          cleanupErrors.push(error);
        }
        killChild("SIGKILL");
        helper.stdin.destroy();
        helper.stdout.destroy();
        helper.stderr.destroy();
        if (!await waitFor(() => helperClosed, deadline - Date.now())) {
          cleanupErrors.push(new Error("Tree cleanup command did not close."));
          helper.unref();
        }
      } else if (helperError !== undefined || helperCode !== 0) {
        cleanupErrors.push(
          helperError ??
            new Error(
              `Tree cleanup exited with code ${helperCode}: ${diagnostic}`,
            ),
        );
        killChild("SIGKILL");
      }
    }
    async function cleanup() {
      const deadline = Date.now() + 2000;
      try {
        if (child !== undefined) {
          child.stdin.destroy();
          if (child.pid !== undefined) {
            if (process.platform === "win32") {
              if (options.cleanup === "tree") {
                if (exited || closed) {
                  cleanupErrors.push(
                    new Error(
                      "Cannot trace a Windows process tree after its root exits.",
                    ),
                  );
                } else await taskkill(deadline);
              } else killChild("SIGKILL");
            } else if (options.cleanup === "tree") {
              const found = groupSignal("SIGTERM");
              if (!found && !exited && !closed) {
                cleanupErrors.push(
                  new Error("The child process group is unavailable."),
                );
              }
              killChild("SIGTERM");
              if (
                found &&
                !await waitFor(
                  () => (exited || closed) && !groupSignal(0),
                  1000,
                )
              ) {
                groupSignal("SIGKILL");
              }
              killChild("SIGKILL");
            } else {
              killChild("SIGTERM");
              if (!await waitFor(() => exited || closed, 1000)) {
                killChild("SIGKILL");
              }
            }
          }
          if (!await waitFor(() => exited || closed, deadline - Date.now())) {
            cleanupErrors.push(
              new Error("The CLI process did not exit during cleanup."),
            );
          }
          // Exit can precede the last pipe reads.  Allow a bounded drain even
          // when descendants still hold the descriptors, then close our ends.
          await waitFor(() => closed, Math.min(250, deadline - Date.now()));
          child.stdout.destroy();
          child.stderr.destroy();
          if (
            !await waitFor(
              () => closed && outClose && errClose && inClose,
              deadline - Date.now(),
            )
          ) {
            cleanupErrors.push(
              new Error(
                "The CLI process streams did not close during cleanup.",
              ),
            );
            child.unref();
          }
        }
      } catch (error) {
        cleanupErrors.push(error);
        killChild("SIGKILL");
        child?.stdin.destroy();
        child?.stdout.destroy();
        child?.stderr.destroy();
        child?.unref();
      }
      if (failure === undefined || settled) return;
      const result = snapshot();
      const primary = new CliInvocationError(
        failure.reason,
        failure.message,
        result,
        { cause: failure.cause },
      );
      settled = true;
      release();
      reject(
        cleanupErrors.length === 0 ? primary : new CliInvocationError(
          "cleanup",
          "CLI cleanup could not be completed.",
          result,
          {
            cause: new AggregateError(
              [primary, ...cleanupErrors],
              "CLI invocation and cleanup failed.",
            ),
          },
        ),
      );
    }
    function onOut(text: string) {
      stdout.push(text);
    }
    function onErr(text: string) {
      stderr.push(text);
    }
    function onError(error: Error) {
      if (failure) cleanupErrors.push(error);
      else fail(spawned ? "io" : "spawn", "Could not execute the CLI.", error);
    }
    function onIoError(error: Error) {
      fail("io", "Could not capture CLI output.", error);
    }
    function onInputError(error: Error) {
      // Windows Node.js reports write EOF when the child exits before reading
      // all input; other runtimes report EPIPE or ECONNRESET for that closure.
      const code = errorCode(error);
      if (code !== "EPIPE" && code !== "ECONNRESET" && code !== "EOF") {
        fail("io", "Could not write CLI input.", error);
      }
    }
    function checkOutput() {
      if (spawned && ((outClose && !outEnd) || (errClose && !errEnd))) {
        fail("io", "CLI output closed before it could be fully read.");
      }
      update();
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    if (options.timeout > 0) {
      timer = setTimeout(
        () => fail("timeout", "CLI invocation timed out."),
        options.timeout,
      );
    }
    try {
      child = spawnCliProcess(command, args, {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== "win32" && options.cleanup === "tree",
      });
      child.on("error", onError);
      child.on("spawn", () => {
        spawned = true;
        checkOutput();
      });
      child.on(
        "exit",
        (code: number | null, terminatingSignal: string | null) => {
          exited = true;
          exitCode = code;
          signal = terminatingSignal;
          update();
        },
      );
      child.on("close", () => {
        closed = true;
        update();
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", onOut);
      child.stderr.on("data", onErr);
      child.stdout.on("error", onIoError);
      child.stderr.on("error", onIoError);
      child.stdin.on("error", onInputError);
      child.stdout.on("end", () => {
        outEnd = true;
        update();
      });
      child.stderr.on("end", () => {
        errEnd = true;
        update();
      });
      child.stdout.on("close", () => {
        outClose = true;
        checkOutput();
      });
      child.stderr.on("close", () => {
        errClose = true;
        checkOutput();
      });
      child.stdin.on("close", () => {
        inClose = true;
        update();
      });
      child.stdin.end(options.stdin, "utf8");
    } catch (cause) {
      fail("spawn", "Could not start the CLI.", cause);
    }
  });
}
