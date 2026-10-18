import { Buffer } from "node:buffer";
import { constants, writeSync } from "node:fs";
import { type FileHandle, open, stat } from "node:fs/promises";
import process from "node:process";
import type { Readable } from "node:stream";

/** An opened input; only file inputs carry an owned handle. */
export type Input =
  | {
    readonly kind: "file";
    readonly handle: FileHandle;
    readonly chunks: () => AsyncIterable<Uint8Array>;
  }
  | {
    readonly kind: "stdin";
    readonly chunks: () => AsyncIterable<Uint8Array>;
  };

/** Handler-time input ownership and output, supplied by program hooks. */
export interface InputScope {
  /** Opens a read-only file or explicit `-` stdin. Throws on I/O failure. */
  readonly open: (path: string) => Promise<Input>;
  /** Writes one result line. Throws if the output writer fails. */
  readonly write: (line: string) => void;
  /** Releases owned handles once; repeated calls share the cleanup promise. */
  readonly close: () => Promise<void>;
}

/** I/O adapters used by the scope and its tests. */
export interface InputOptions {
  readonly stdin?: () => Readable;
  readonly openFile?: (path: string) => Promise<FileHandle>;
  readonly write?: (line: string) => void;
}

/**
 * Creates a lazy input opener without accessing stdin or opening a file.
 * @param options Optional I/O adapters.
 * @returns A scope that owns files, while leaving inherited stdin open.
 */
export function createInputScope(options: InputOptions = {}): InputScope {
  const handles = new Set<FileHandle>();
  let cleanup: Promise<void> | undefined;
  return {
    write: options.write ?? ((line) => {
      // Keep failures from these small result lines inside the handler promise.
      const bytes = Buffer.from(`${line}\n`);
      let offset = 0;
      while (offset < bytes.length) {
        offset += writeSync(
          process.stdout.fd,
          bytes,
          offset,
          bytes.length - offset,
        );
      }
    }),
    async open(path) {
      if (cleanup != null) throw new TypeError("Input scope is closed.");
      if (path === "-") {
        const stdin = (options.stdin ?? (() => process.stdin))();
        return {
          kind: "stdin",
          async *chunks() {
            // Early return must not destroy a stream owned by the caller.
            for await (
              const chunk of stdin.iterator({ destroyOnReturn: false })
            ) {
              if (!(chunk instanceof Uint8Array)) {
                throw new TypeError("Expected byte input from stdin.");
              }
              yield chunk;
            }
          },
        };
      }
      if (!(await stat(path)).isFile()) {
        throw new TypeError("Input must be a regular file.");
      }
      // Avoid waiting if the checked path is replaced with a FIFO before open.
      // The acquired handle is validated independently below.
      const handle = await (options.openFile ??
        ((path) => open(path, constants.O_RDONLY | constants.O_NONBLOCK)))(
          path,
        );
      handles.add(handle);
      if (!(await handle.stat()).isFile()) {
        throw new TypeError("Input must be a regular file.");
      }
      return {
        kind: "file",
        handle,
        async *chunks() {
          while (true) {
            const buffer = new Uint8Array(64 * 1024);
            const { bytesRead } = await handle.read(
              buffer,
              0,
              buffer.length,
              null,
            );
            if (bytesRead === 0) return;
            yield buffer.subarray(0, bytesRead);
          }
        },
      };
    },
    close() {
      return cleanup ??= Promise.all(
        [...handles].map((handle) => handle.close()),
      )
        .then(() => {});
    },
  };
}
