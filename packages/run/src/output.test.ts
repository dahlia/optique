import { shouldWriteDirectly, writeAllSync } from "./output.ts";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code} error.`), { code });
}

interface WriteCall {
  readonly fd: number;
  readonly bytes: Uint8Array;
}

/**
 * Creates a fake `writeSync()` that plays back the given steps: a number
 * accepts that many bytes (capped at the requested length), and a string
 * throws an error with that code.  Once the steps run out, every call
 * accepts the whole request.
 */
function fakeWriteSync(steps: readonly (number | string)[]) {
  const calls: WriteCall[] = [];
  let step = 0;
  const writeSync = (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
  ): number => {
    calls.push({ fd, bytes: buffer.slice(offset, offset + length) });
    const next = step < steps.length ? steps[step++] : length;
    if (typeof next === "string") throw errnoError(next);
    return Math.min(next, length);
  };
  return { calls, writeSync };
}

function written(calls: readonly WriteCall[], accepted: readonly number[]) {
  const chunks = calls.map((call, i) =>
    call.bytes.slice(0, accepted[i] ?? call.bytes.length)
  );
  return Buffer.concat(chunks);
}

describe("writeAllSync()", () => {
  it("writes nothing for empty input", () => {
    const { calls, writeSync } = fakeWriteSync([]);
    writeAllSync(1, new Uint8Array(0), { writeSync });
    assert.equal(calls.length, 0);
  });

  it("writes the whole buffer in a single call when possible", () => {
    const { calls, writeSync } = fakeWriteSync([]);
    const bytes = Buffer.from("hello\n");
    writeAllSync(2, bytes, { writeSync });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fd, 2);
    assert.deepEqual(Buffer.from(calls[0].bytes), bytes);
  });

  it("resumes partial writes from the correct byte offset", () => {
    // "✓" is three bytes in UTF-8, so a two-byte partial write splits it:
    const bytes = Buffer.from("a✓b한글");
    const { calls, writeSync } = fakeWriteSync([2, 3, 1]);
    writeAllSync(1, bytes, { writeSync });
    assert.deepEqual(
      calls.map((call) => Buffer.from(call.bytes).toString("hex")),
      [
        bytes.toString("hex"),
        bytes.subarray(2).toString("hex"),
        bytes.subarray(5).toString("hex"),
        bytes.subarray(6).toString("hex"),
      ],
    );
    assert.deepEqual(written(calls, [2, 3, 1]), bytes);
  });

  for (const code of ["EAGAIN", "EWOULDBLOCK"]) {
    it(`sleeps and retries on ${code} without restarting`, () => {
      const bytes = Buffer.from("0123456789");
      const { calls, writeSync } = fakeWriteSync([4, code, code, 3]);
      const sleeps: number[] = [];
      writeAllSync(1, bytes, { writeSync, sleep: (ms) => sleeps.push(ms) });
      assert.equal(sleeps.length, 2);
      assert.ok(sleeps.every((ms) => ms > 0));
      assert.deepEqual(
        calls.map((call) => Buffer.from(call.bytes).toString()),
        ["0123456789", "456789", "456789", "456789", "789"],
      );
    });
  }

  it("retries immediately on EINTR", () => {
    const bytes = Buffer.from("abc");
    const { calls, writeSync } = fakeWriteSync(["EINTR"]);
    const sleeps: number[] = [];
    writeAllSync(1, bytes, { writeSync, sleep: (ms) => sleeps.push(ms) });
    assert.equal(sleeps.length, 0);
    assert.equal(calls.length, 2);
  });

  for (const code of ["EPIPE", "ECONNRESET"]) {
    it(`stops without throwing on ${code}`, () => {
      const bytes = Buffer.from("0123456789");
      const { calls, writeSync } = fakeWriteSync([4, code]);
      writeAllSync(1, bytes, { writeSync });
      assert.equal(calls.length, 2);
    });
  }

  it("propagates other errors, even after partial success", () => {
    const bytes = Buffer.from("0123456789");
    const { calls, writeSync } = fakeWriteSync([4, "ENOSPC"]);
    assert.throws(
      () => writeAllSync(1, bytes, { writeSync }),
      (error: NodeJS.ErrnoException) => error.code === "ENOSPC",
    );
    assert.equal(calls.length, 2);
  });

  it("throws instead of looping when no progress is made", () => {
    const { writeSync } = fakeWriteSync([0]);
    assert.throws(
      () => writeAllSync(1, Buffer.from("abc"), { writeSync }),
      Error,
    );
  });

  it("propagates errors thrown by sleep()", () => {
    const { writeSync } = fakeWriteSync(["EAGAIN"]);
    const sleepError = new Error("Sleep failed.");
    assert.throws(
      () =>
        writeAllSync(1, Buffer.from("abc"), {
          writeSync,
          sleep: () => {
            throw sleepError;
          },
        }),
      (error) => error === sleepError,
    );
  });

  it("sleeps with the default implementation", () => {
    const { calls, writeSync } = fakeWriteSync(["EAGAIN"]);
    writeAllSync(1, Buffer.from("abc"), { writeSync });
    assert.equal(calls.length, 2);
  });
});

describe("shouldWriteDirectly()", () => {
  it("accepts a non-TTY stream with a file descriptor on POSIX", () => {
    assert.ok(shouldWriteDirectly({ isTTY: false, fd: 1 }, "linux", false));
    assert.ok(shouldWriteDirectly({ fd: 2 }, "darwin", false));
    assert.ok(shouldWriteDirectly({ fd: 0 }, "linux", false));
  });

  it("rejects TTYs", () => {
    assert.ok(!shouldWriteDirectly({ isTTY: true, fd: 1 }, "linux", false));
  });

  it("rejects Windows", () => {
    assert.ok(!shouldWriteDirectly({ isTTY: false, fd: 1 }, "win32", false));
  });

  it("rejects Deno", () => {
    // Deno's fs.writeSync() can write part of the buffer and then throw
    // EAGAIN without reporting how much it wrote, so retrying would
    // duplicate output:
    assert.ok(!shouldWriteDirectly({ isTTY: false, fd: 1 }, "linux", true));
    assert.ok(shouldWriteDirectly({ isTTY: false, fd: 1 }, "linux", false));
  });

  it("rejects streams without a valid file descriptor", () => {
    // For example, process.stdout in a Node.js worker thread has no fd:
    assert.ok(!shouldWriteDirectly({}, "linux", false));
    assert.ok(!shouldWriteDirectly({ fd: undefined }, "linux", false));
    assert.ok(!shouldWriteDirectly({ fd: -1 }, "linux", false));
    assert.ok(!shouldWriteDirectly({ fd: 1.5 }, "linux", false));
    assert.ok(!shouldWriteDirectly({ fd: "1" }, "linux", false));
  });
});
