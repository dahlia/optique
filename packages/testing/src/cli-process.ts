/** Internal process adapters for the CLI testing boundary. */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import process from "node:process";
import { Readable, Writable } from "node:stream";
import type { ReadableStream, WritableStream } from "node:stream/web";

/** The process operations used by the invocation lifecycle. */
export interface CliProcess extends EventEmitter {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  unref(): void;
}

/** Launch settings shared by the Node and Deno adapters. */
export interface CliSpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly detached: boolean;
}

interface DenoChild {
  readonly pid: number;
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly status: Promise<
    { readonly code: number; readonly signal: string | null }
  >;
  kill(signal: string): void;
  unref(): void;
}

interface DenoRuntime {
  readonly Command: new (command: string, options: {
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly clearEnv: boolean;
    readonly stdin: "piped";
    readonly stdout: "piped";
    readonly stderr: "piped";
    readonly windowsHide: boolean;
  }) => { spawn(): DenoChild };
}

function isDenoRuntime(value: unknown): value is DenoRuntime {
  return typeof value === "object" && value !== null && "Command" in value &&
    typeof value.Command === "function";
}

/**
 * Uses Deno's native asynchronous pipes when available.
 * Kept separate so its real I/O can also be tested on non-Windows Deno hosts.
 * @param command Executable path.
 * @param args Literal command arguments.
 * @param options Working directory and complete child environment.
 * @returns A process adapter, or undefined outside Deno.
 * @throws If Deno cannot start the requested executable.
 */
export function spawnDenoProcess(
  command: string,
  args: readonly string[],
  options: CliSpawnOptions,
): CliProcess | undefined {
  const runtime: unknown = "Deno" in globalThis ? globalThis.Deno : undefined;
  if (!isDenoRuntime(runtime)) return;
  const native = new runtime.Command(command, {
    args,
    cwd: options.cwd,
    env: options.env,
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    windowsHide: true,
  }).spawn();
  const stdin = Writable.fromWeb(native.stdin);
  const stdout = Readable.fromWeb(native.stdout);
  const stderr = Readable.fromWeb(native.stderr);
  const child = Object.assign(new EventEmitter(), {
    pid: native.pid,
    stdin,
    stdout,
    stderr,
    kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
      native.kill(signal);
      return true;
    },
    unref(): void {
      native.unref();
    },
  });
  let exited = false;
  let closed = false;
  let closedStreams = 0;
  const maybeClose = () => {
    if (exited && closedStreams === 3 && !closed) {
      closed = true;
      child.emit("close");
    }
  };
  for (const stream of [stdin, stdout, stderr]) {
    stream.once("close", () => {
      closedStreams++;
      maybeClose();
    });
  }
  queueMicrotask(() => child.emit("spawn"));
  native.status.then((status) => {
    exited = true;
    child.emit(
      "exit",
      status.signal === null ? status.code : null,
      status.signal,
    );
    stdin.destroy();
    maybeClose();
  }, (error: unknown) => {
    exited = true;
    child.emit("error", error);
    maybeClose();
  });
  return child;
}

/**
 * Launches a CLI with pipes that leave the host event loop responsive.
 * @param command Executable path.
 * @param args Literal command arguments.
 * @param options Working directory, environment, and process group settings.
 * @returns The launched process and its three streams.
 * @throws If the runtime rejects the launch synchronously.
 */
export function spawnCliProcess(
  command: string,
  args: readonly string[],
  options: CliSpawnOptions,
): CliProcess {
  // Deno's Node-compatible Windows pipes can block the JS thread during a
  // large write. Native web streams keep reads, writes, and timers concurrent.
  if (process.platform === "win32") {
    const native = spawnDenoProcess(command, args, options);
    if (native !== undefined) return native;
  }
  return spawn(command, [...args], {
    ...options,
    shell: false,
    stdio: "pipe",
    windowsHide: true,
  });
}
