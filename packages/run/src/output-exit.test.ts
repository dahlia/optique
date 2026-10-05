/**
 * Subprocess regression tests for output that must be written completely
 * before Optique exits the process, even when the output goes to a pipe whose
 * reader is slow.  See https://github.com/dahlia/optique/issues/1008.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "test-fixtures",
);
const esmFixture = join(fixturesDir, "output-exit.mjs");
const cjsFixture = join(fixturesDir, "output-exit.cjs");
const isWindows = process.platform === "win32";
const isDeno = "Deno" in globalThis;
const watchdogMs = 60_000;

interface Captured {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly status: number | null;
}

function runtimeCommand(fixture: string): readonly string[] {
  if (isDeno) {
    return [process.execPath, "run", "--allow-env", "--allow-read", fixture];
  }
  return [process.execPath, fixture];
}

function spawnAndCapture(
  command: readonly string[],
  env: Record<string, string>,
): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      // Run in a separate process group so that the watchdog can kill the
      // whole pipeline, including a producer blocked on a full pipe:
      detached: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const watchdog = setTimeout(() => {
      if (child.pid != null && child.pid > 0) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }, watchdogMs);
    child.on("error", (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(watchdog);
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        status,
      });
    });
  });
}

interface Rendered {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly status: number;
}

/**
 * Runs a fixture case in render mode, which captures the output through
 * custom callbacks and lets the process exit naturally.  This gives the bytes
 * the default writers are expected to deliver.
 */
async function renderCase(
  fixture: string,
  caseName: string,
  args: readonly string[] = [],
): Promise<Rendered> {
  const result = await spawnAndCapture(
    [...runtimeCommand(fixture), ...args],
    { OPTIQUE_FIXTURE_CASE: caseName, OPTIQUE_FIXTURE_RENDER: "1" },
  );
  assert.notEqual(result.status, null, "render mode was killed");
  return { ...result, status: result.status ?? -1 };
}

interface Delivered {
  /** Bytes the slow reader received from the target stream. */
  readonly target: Buffer;
  /** Bytes written to the other stream. */
  readonly other: Buffer;
  /** Exit status of the fixture process itself (not the pipeline). */
  readonly status: number;
}

type Sink = "slow-pipe" | "file" | "closed-pipe";

/**
 * Runs a fixture case with the target stream connected to the given sink.
 *
 * With `"slow-pipe"`, the reader takes a single byte, stalls for a second,
 * and then drains the rest.  Reading the first byte before stalling ensures
 * the fixture has started writing, so the stall reliably overlaps with the
 * point at which the fixture would exit.
 */
async function deliverCase(
  fixture: string,
  caseName: string,
  target: "stdout" | "stderr",
  sink: Sink,
  args: readonly string[] = [],
): Promise<Delivered> {
  const dir = await mkdtemp(join(tmpdir(), "optique-output-exit-"));
  try {
    const statusFile = join(dir, "status");
    const otherFile = join(dir, "other");
    const targetFile = join(dir, "target");
    const redirect = target === "stdout"
      ? `2>"$OTHER_FILE"`
      : `2>&1 >"$OTHER_FILE"`;
    const producer = sink === "file"
      ? `{ "$@" ${
        target === "stdout"
          ? `>"$TARGET_FILE" 2>"$OTHER_FILE"`
          : `2>"$TARGET_FILE" >"$OTHER_FILE"`
      }; echo $? >"$STATUS_FILE"; }`
      : `{ "$@" ${redirect}; echo $? >"$STATUS_FILE"; }`;
    const script = sink === "slow-pipe"
      ? `${producer} | { dd bs=1 count=1 2>/dev/null; sleep 1; cat; }`
      : sink === "closed-pipe"
      ? `${producer} | head -c 10 >/dev/null`
      : producer;
    const result = await spawnAndCapture(
      ["sh", "-c", script, "sh", ...runtimeCommand(fixture), ...args],
      {
        OPTIQUE_FIXTURE_CASE: caseName,
        STATUS_FILE: statusFile,
        OTHER_FILE: otherFile,
        TARGET_FILE: targetFile,
      },
    );
    assert.equal(
      result.status,
      0,
      `pipeline failed: ${result.stderr.toString("utf8").slice(-2000)}`,
    );
    const statusText = await readFile(statusFile, "utf8");
    const status = Number.parseInt(statusText.trim(), 10);
    assert.ok(
      Number.isInteger(status),
      `invalid status file: ${statusText}`,
    );
    return {
      target: sink === "file" ? await readFile(targetFile) : result.stdout,
      other: await readFile(otherFile),
      status,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertLargePayload(output: Buffer): void {
  assert.ok(
    output.length > 1024 * 1024,
    `expected output to exceed 1 MiB, got ${output.length} bytes`,
  );
  const text = output.toString("utf8");
  assert.ok(text.includes("BEGIN-MARKER"), "missing BEGIN-MARKER");
  assert.ok(text.includes("END-MARKER"), "missing END-MARKER");
}

async function assertCompleteDelivery(
  caseName: string,
  target: "stdout" | "stderr",
  expectedStatus: number,
  options: {
    readonly sink?: Sink;
    readonly fixture?: string;
    readonly args?: readonly string[];
    readonly includes?: string;
  } = {},
): Promise<void> {
  const fixture = options.fixture ?? esmFixture;
  const expected = await renderCase(fixture, caseName, options.args);
  const other = target === "stdout" ? "stderr" : "stdout";
  assert.equal(
    expected.status,
    expectedStatus,
    `render mode failed: ${expected.stderr.toString("utf8").slice(-2000)}`,
  );
  assertLargePayload(expected[target]);
  if (options.includes != null) {
    assert.ok(
      expected[target].toString("utf8").includes(options.includes),
      `expected ${target} to include ${JSON.stringify(options.includes)}`,
    );
  }
  const delivered = await deliverCase(
    fixture,
    caseName,
    target,
    options.sink ?? "slow-pipe",
    options.args,
  );
  assert.equal(
    delivered.status,
    expectedStatus,
    `unexpected exit status; other stream: ${
      delivered.other.toString("utf8").slice(-2000)
    }`,
  );
  assert.ok(
    delivered.other.equals(expected[other]),
    `unexpected ${other}: ${delivered.other.toString("utf8").slice(-2000)}`,
  );
  // Compare lengths first to keep failure messages short:
  assert.equal(delivered.target.length, expected[target].length);
  assert.ok(delivered.target.equals(expected[target]));
}

describe("output written before exit", {
  skip: isWindows,
}, () => {
  const cases: readonly {
    readonly name: string;
    readonly target: "stdout" | "stderr";
    readonly status: number;
    readonly args?: readonly string[];
    readonly includes?: string;
  }[] = [
    { name: "run-sync-help", target: "stdout", status: 0 },
    { name: "runsync-help", target: "stdout", status: 0 },
    { name: "run-async-help", target: "stdout", status: 0 },
    { name: "runasync-help", target: "stdout", status: 0 },
    { name: "runsync-version", target: "stdout", status: 0 },
    { name: "completion-script", target: "stdout", status: 0 },
    { name: "completion-suggestions", target: "stdout", status: 0 },
    { name: "sync-error", target: "stderr", status: 3 },
    { name: "async-error", target: "stderr", status: 3 },
    { name: "contexts-error", target: "stderr", status: 3 },
    { name: "custom-on-exit", target: "stdout", status: 5 },
    {
      name: "default-handlers",
      target: "stdout",
      status: 0,
      args: ["--help"],
      // The default program name is the basename of process.argv[1]:
      includes: "Usage: output-exit.mjs",
    },
    {
      name: "default-handlers",
      target: "stderr",
      status: 1,
      args: [],
      includes: "Usage: output-exit.mjs",
    },
    { name: "print-error-stderr", target: "stderr", status: 4 },
    { name: "print-error-stdout", target: "stdout", status: 0 },
  ];

  for (const { name, target, status, args, includes } of cases) {
    it(`delivers complete ${target} to a slow pipe (${name})`, async () => {
      // Bun ignores the skip option, so we need an early return as well:
      if (isWindows) return;
      await assertCompleteDelivery(name, target, status, { args, includes });
    });
  }

  it("delivers complete output to a regular file", async () => {
    if (isWindows) return;
    await assertCompleteDelivery("run-sync-help", "stdout", 0, {
      sink: "file",
    });
    await assertCompleteDelivery("sync-error", "stderr", 3, { sink: "file" });
  });

  it("keeps the exit code when the reader closes the pipe early", async () => {
    if (isWindows) return;
    for (
      const [name, target, status] of [
        ["run-sync-help", "stdout", 0],
        ["sync-error", "stderr", 3],
        ["print-error-stderr", "stderr", 4],
      ] as const
    ) {
      const delivered = await deliverCase(
        esmFixture,
        name,
        target,
        "closed-pipe",
      );
      assert.equal(delivered.status, status, name);
      if (target === "stdout") {
        // Nothing, including an uncaught EPIPE error, goes to stderr:
        assert.equal(delivered.other.toString("utf8"), "", name);
      }
    }
  });

  it("delivers complete output from the CommonJS build", {
    skip: isDeno,
  }, async () => {
    if (isWindows || isDeno) return;
    await assertCompleteDelivery("cjs", "stdout", 0, {
      fixture: cjsFixture,
    });
  });
});
