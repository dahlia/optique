import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import process from "node:process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { it } from "node:test";
import { countLines } from "./commands/lines.ts";
import { createInputScope } from "./input.ts";

it("counts LF boundaries and a final unterminated segment across byte chunks", async () => {
  for (
    const [chunks, expected] of [
      [[], 0],
      [[""], 0],
      [["one"], 1],
      [["one\n"], 1],
      [["\n", "\n"], 2],
      [["one\r", "\ntwo\r", "\nthree"], 3],
    ] as const
  ) {
    const bytes = async function* () {
      for (const chunk of chunks) yield Buffer.from(chunk);
    };
    assert.equal(await countLines(bytes()), expected);
  }
  const utf8 = Buffer.from("한글\n끝");
  async function* splitBytes() {
    for (const byte of utf8) yield new Uint8Array([byte]);
  }
  assert.equal(await countLines(splitBytes()), 2);
});

it("opens files lazily, releases actual handles once, and never requests stdin", async () => {
  const directory = await mkdtemp(join(tmpdir(), "file-inspect-input-"));
  const path = join(directory, "sample.txt");
  await writeFile(path, "one\ntwo\n");
  let releases = 0;
  const scope = createInputScope({
    stdin() {
      throw new Error("Unexpected stdin access.");
    },
    async openFile(path) {
      const handle = await open(path, "r");
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        releases++;
      };
      return handle;
    },
  });
  try {
    const input = await scope.open(path);
    assert.equal(input.kind, "file");
    if (input.kind !== "file") throw new TypeError("Expected a file.");
    assert.equal((await input.handle.stat()).size, 8);
    assert.equal(await countLines(input.chunks()), 2);
    await Promise.all([scope.close(), scope.close()]);
    assert.equal(releases, 1);
    await assert.rejects(input.handle.stat());
    await assert.rejects(scope.open(path), /closed/i);
  } finally {
    await scope.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("leaves inherited stdin open after early iterator return and cleanup", async () => {
  const stdin = Readable.from([Buffer.from("one\n"), Buffer.from("two\n")], {
    autoDestroy: false,
  });
  let requests = 0;
  const scope = createInputScope({ stdin: () => (requests++, stdin) });
  try {
    assert.equal(requests, 0);
    const input = await scope.open("-");
    assert.equal(input.kind, "stdin");
    for await (const chunk of input.chunks()) {
      assert.ok(chunk.length > 0);
      break;
    }
    await scope.close();
    await scope.close();
    assert.equal(requests, 1);
    assert.ok(!stdin.destroyed);
  } finally {
    stdin.destroy();
  }
});

it("rejects a non-regular acquired handle and releases it once", {
  skip: process.platform !== "linux",
}, async () => {
  if (process.platform !== "linux") return;
  const directory = await mkdtemp(join(tmpdir(), "file-inspect-swapped-"));
  const path = join(directory, "sample.txt");
  const fifo = join(directory, "input.fifo");
  await writeFile(path, "sample");
  execFileSync("mkfifo", [fifo]);
  let releases = 0;
  const scope = createInputScope({
    async openFile() {
      // Simulate the file being replaced after the path check, without a race.
      const handle = await open(
        fifo,
        constants.O_RDONLY | constants.O_NONBLOCK,
      );
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        releases++;
      };
      return handle;
    },
  });
  try {
    await assert.rejects(scope.open(path), /regular file/);
    await scope.close();
    await scope.close();
    assert.equal(releases, 1);
  } finally {
    await scope.close();
    await rm(directory, { recursive: true, force: true });
  }
});
