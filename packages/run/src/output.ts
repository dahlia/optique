/**
 * Internal helpers for writing output that must be complete before the
 * process exits.  Not part of the public API.
 *
 * Node.js and Bun put stdout/stderr into non-blocking mode when they are
 * pipes, and queue whatever the pipe cannot take immediately.  Calling
 * `process.exit()` afterward discards that queue, truncating output read by
 * a slow consumer.  Writing directly to the file descriptor and retrying
 * until every byte is accepted avoids that without requiring the exit path
 * to become asynchronous.  See https://github.com/dahlia/optique/issues/1008.
 * @module
 */
import { writeSync as fsWriteSync } from "node:fs";
import process from "node:process";

/**
 * Dependencies of {@link writeAllSync}, injectable for testing.
 * @internal
 */
export interface WriteAllSyncDeps {
  /**
   * Writes bytes to a file descriptor and returns how many bytes were
   * written.
   * @default `writeSync()` from `node:fs`
   */
  readonly writeSync?: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
  ) => number;

  /**
   * Blocks the current thread for the given number of milliseconds.
   * @default A sleep based on `Atomics.wait()`
   */
  readonly sleep?: (ms: number) => void;
}

let sleepCell: Int32Array | undefined;

function sleepSync(ms: number): void {
  // Allocated lazily so that importing this module never requires
  // SharedArrayBuffer:
  sleepCell ??= new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sleepCell, 0, 0, ms);
}

function getErrorCode(error: unknown): unknown {
  return typeof error === "object" && error != null && "code" in error
    ? error.code
    : undefined;
}

/**
 * Writes all of the given bytes to a file descriptor synchronously.
 *
 * Partial writes resume from the next unwritten byte.  When the descriptor
 * is non-blocking and temporarily full (`EAGAIN`/`EWOULDBLOCK`), this sleeps
 * briefly and retries, blocking the current thread until the reader catches
 * up.  When the reader has closed the pipe (`EPIPE`) or reset the socket
 * (`ECONNRESET`), the rest of the output cannot be delivered, so this returns
 * silently.
 *
 * @param fd The file descriptor to write to.
 * @param bytes The bytes to write.
 * @param deps Dependencies to use instead of the defaults, for testing.
 * @throws {Error} If writing fails for any other reason, or if a write makes
 *         no progress.
 * @internal
 */
export function writeAllSync(
  fd: number,
  bytes: Uint8Array,
  deps: WriteAllSyncDeps = {},
): void {
  const writeSync = deps.writeSync ?? fsWriteSync;
  const sleep = deps.sleep ?? sleepSync;
  let offset = 0;
  while (offset < bytes.length) {
    let written: number;
    try {
      written = writeSync(fd, bytes, offset, bytes.length - offset);
    } catch (error) {
      const code = getErrorCode(error);
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        sleep(1);
        continue;
      }
      if (code === "EINTR") continue;
      // The reader is gone, whether it closed a pipe or reset a socket:
      if (code === "EPIPE" || code === "ECONNRESET") return;
      throw error;
    }
    if (written <= 0) {
      throw new Error(
        `Failed to write output to file descriptor ${fd}: ` +
          "no bytes were written.",
      );
    }
    offset += written;
  }
}

/**
 * The subset of a writable stdio stream that {@link shouldWriteDirectly}
 * inspects.
 * @internal
 */
export interface StdioStreamLike {
  readonly isTTY?: boolean;
  readonly fd?: unknown;
  /** The encoding the stream applies to strings, if known. */
  readonly defaultEncoding?: unknown;
}

/**
 * Reads the encoding a writable stream applies to strings, which
 * `setDefaultEncoding()` changes.  Node.js and Bun expose it only through
 * the stream's internal state, so this returns `undefined` when that is not
 * available.
 *
 * @param stream The stream to inspect.
 * @returns The default encoding, or `undefined` if it cannot be read.
 * @internal
 */
export function getDefaultEncoding(stream: object): unknown {
  if (!("_writableState" in stream)) return undefined;
  const state = stream._writableState;
  return typeof state === "object" && state != null &&
      "defaultEncoding" in state
    ? state.defaultEncoding
    : undefined;
}

function isUtf8Encoding(encoding: unknown): boolean {
  return encoding === undefined ||
    (typeof encoding === "string" &&
      ["utf8", "utf-8"].includes(encoding.toLowerCase()));
}

/**
 * Decides whether output for the given stream should bypass the stream and
 * be written directly to its file descriptor.
 *
 * TTYs keep going through the stream, since terminal writes are synchronous
 * on POSIX and Windows consoles need the stream's own handling.  Windows is
 * excluded altogether.  Streams without a file descriptor, such as
 * `process.stdout` in a Node.js worker thread, also keep going through the
 * stream, since writing to fd 1 or 2 would bypass the worker's redirection.
 * Deno is excluded as well: its streams do not lose queued output on exit,
 * and its `fs.writeSync()` can write part of the buffer to a non-blocking
 * pipe and then throw `EAGAIN` without reporting how much it wrote, which
 * would make retrying duplicate output.  Finally, streams whose default
 * encoding is not UTF-8 keep going through the stream, since direct writes
 * always encode the text as UTF-8.
 *
 * @param stream The stream to inspect.
 * @param platform The value of `process.platform`.
 * @param deno Whether the current runtime is Deno.
 * @returns `true` if output should be written directly to `stream.fd`.
 * @internal
 */
export function shouldWriteDirectly(
  stream: StdioStreamLike,
  platform: string,
  deno: boolean,
): boolean {
  const fd = stream.fd;
  return !deno && platform !== "win32" && !stream.isTTY &&
    typeof fd === "number" && Number.isInteger(fd) && fd >= 0 &&
    isUtf8Encoding(stream.defaultEncoding);
}

const encoder = new TextEncoder();

/**
 * Writes text to standard output or standard error such that, when the
 * stream is a pipe or a file, the text has been completely handed to the
 * operating system by the time this returns (unless the reader closed the
 * pipe).  Otherwise, it falls back to the stream's `write()` method.
 *
 * Note that output queued in the stream by earlier `write()` calls is not
 * flushed, and that text written directly can overtake it.
 *
 * @param streamName The stream to write to.
 * @param text The text to write.
 * @throws {Error} If writing to the file descriptor fails.
 * @internal
 */
export function writeOutput(
  streamName: "stdout" | "stderr",
  text: string,
): void {
  const stream = process[streamName];
  const streamLike: StdioStreamLike = {
    isTTY: stream.isTTY,
    fd: stream.fd,
    defaultEncoding: getDefaultEncoding(stream),
  };
  if (shouldWriteDirectly(streamLike, process.platform, "Deno" in globalThis)) {
    writeAllSync(stream.fd, encoder.encode(text));
  } else {
    stream.write(text);
  }
}
