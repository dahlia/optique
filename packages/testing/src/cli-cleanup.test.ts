import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, it } from "node:test";
import {
  cleanupCliProcess,
  type CleanupClock,
  type CleanupState,
  createCleanupWaiter,
} from "./cli-cleanup.ts";
import { type CliProcess, spawnCliProcess } from "./cli-process.ts";

describe("cleanupCliProcess", () => {
  it("should allow tree termination beyond one second within the shared deadline", async () => {
    // Arrange
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    const getState = observe(child, waiter.notify);
    const errors: unknown[] = [];
    clock.schedule(() => {
      child.finish();
      helper.finish();
    }, 1200);

    // Act
    await clock.run(cleanupCliProcess({
      child,
      mode: "tree",
      getState,
      waiter,
      recordError: (error) => errors.push(error),
    }, {
      platform: "win32",
      systemRoot: () => "C:\\Windows",
      spawnHelper: () => helper,
    }));
    waiter.dispose();

    // Assert
    assert.deepEqual(errors, []);
    assert.equal(clock.now(), 1200);
    assert.ok(getState().closed);
  });

  it("should preserve a helper error and retire the failed helper promptly", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    const getState = observe(child, waiter.notify);
    const errors: unknown[] = [];
    const cause = new Error("Helper failed.");
    clock.schedule(() => helper.emit("error", cause), 100);

    await clock.run(cleanupCliProcess({
      child,
      mode: "tree",
      getState,
      waiter,
      recordError: (error) => errors.push(error),
    }, {
      platform: "win32",
      systemRoot: () => "C:\\Windows",
      spawnHelper: () => helper,
    }));
    waiter.dispose();

    assert.ok(
      errors.some((error) => error instanceof Error && error.cause === cause),
    );
    assert.equal(clock.now(), 100);
    assert.deepEqual(helper.signals, ["SIGKILL"]);
    assert.ok(getState().closed);
  });
  it("should retain timeout failure even when forced termination closes the helper", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    const errors: unknown[] = [];
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "tree",
        getState: observe(child, waiter.notify),
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        platform: "win32",
        systemRoot: () => "C:\\Windows",
        spawnHelper: () => helper,
      }),
    );
    waiter.dispose();
    assert.equal(clock.now(), 2000);
    assert.deepEqual(helper.signals, ["SIGKILL"]);
    assert.deepEqual(child.signals, ["SIGKILL"]);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /tree cleanup command timed out/);
    const snapshot = [...errors];
    helper.emit("error", new Error("Late process error."));
    helper.stdout.emit("error", new Error("Late pipe error."));
    assert.deepEqual(errors, snapshot);
  });

  it("should observe deferred pipe closure without extending an expired deadline", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    child.kill = (signal = "SIGTERM") => {
      child.signals.push(signal);
      child.emit("exit", 0, null);
      clock.schedule(() => child.finish(), 0);
      return true;
    };
    const errors: unknown[] = [];
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "tree",
        getState: observe(child, waiter.notify),
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        platform: "win32",
        systemRoot: () => "C:\\Windows",
        spawnHelper: () => helper,
      }),
    );
    waiter.dispose();
    assert.equal(clock.now(), 2000);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /tree cleanup command timed out/);
    assert.ok(!child.unreferenced);
    assert.equal(clock.pendingCount, 0);
  });

  it("should keep output read errors while allowing taskkill to finish", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    const errors: unknown[] = [];
    const cause = Object.assign(new Error("Read failed."), { code: "EPIPE" });
    clock.schedule(() => helper.stdout.emit("error", cause), 100);
    clock.schedule(() => {
      child.finish();
      helper.finish();
    }, 1200);
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "tree",
        getState: observe(child, waiter.notify),
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        platform: "win32",
        systemRoot: () => "C:\\Windows",
        spawnHelper: () => helper,
      }),
    );
    waiter.dispose();
    assert.equal(clock.now(), 1200);
    assert.deepEqual(helper.signals, []);
    assert.equal(errors.length, 1);
    assert.ok(errors[0] instanceof Error);
    assert.equal(errors[0].cause, cause);
    assert.match(errors[0].message, /stdout/);
  });

  it("should report nonzero taskkill status with its diagnostic", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    const errors: unknown[] = [];
    clock.schedule(() => {
      helper.stderr.write("Access denied.");
      helper.finish(5);
    }, 100);
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "tree",
        getState: observe(child, waiter.notify),
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        platform: "win32",
        systemRoot: () => "C:\\Windows",
        spawnHelper: () => helper,
      }),
    );
    waiter.dispose();
    assert.equal(clock.now(), 100);
    assert.match(String(errors[0]), /code 5: Access denied/);
    assert.deepEqual(child.signals, ["SIGKILL"]);
  });

  it("should avoid launching taskkill with an exited root PID", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const getState = observe(child, waiter.notify);
    child.finish();
    const errors: unknown[] = [];
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "tree",
        getState,
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        platform: "win32",
        spawnHelper: () => {
          assert.fail("Stale PID used.");
        },
      }),
    );
    waiter.dispose();
    assert.match(String(errors[0]), /after its root exits/);
    assert.deepEqual(child.signals, []);
  });

  it("should close other streams and unreference processes when operations throw", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    const helper = new TestProcess(102);
    const errors: unknown[] = [];
    const killError = new Error("Kill failed.");
    const destroyError = new Error("Destroy failed.");
    child.kill = helper.kill = () => {
      throw killError;
    };
    helper.stdout.destroy = () => {
      throw destroyError;
    };
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "tree",
        getState: observe(child, waiter.notify),
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        platform: "win32",
        systemRoot: () => "C:\\Windows",
        spawnHelper: () => helper,
      }),
    );
    waiter.dispose();
    assert.equal(clock.now(), 2000);
    assert.ok(child.stdout.destroyed && child.stderr.destroyed);
    assert.ok(helper.stdin.destroyed && helper.stderr.destroyed);
    assert.ok(child.unreferenced && helper.unreferenced);
    assert.ok(
      errors.some((error) =>
        error instanceof Error && error.cause === killError
      ),
    );
    assert.ok(
      errors.some((error) =>
        error instanceof Error && error.cause === destroyError
      ),
    );
    PassThrough.prototype.destroy.call(helper.stdout);
  });

  it("should retain the POSIX child termination grace period", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const child = new TestProcess(101);
    child.kill = (signal = "SIGTERM") => {
      child.signals.push(signal);
      if (signal === "SIGKILL") child.finish();
      return true;
    };
    const errors: unknown[] = [];
    await clock.run(
      cleanupCliProcess({
        child,
        mode: "child",
        getState: observe(child, waiter.notify),
        waiter,
        recordError: (error) => errors.push(error),
      }, { platform: "linux" }),
    );
    waiter.dispose();
    assert.equal(clock.now(), 1000);
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.deepEqual(errors, []);
  });
});

describe("Windows tree cleanup integration", () => {
  it("should let a delayed real taskkill terminate descendants", {
    timeout: 20_000,
    skip: process.platform !== "win32",
  }, async () => {
    if (process.platform !== "win32") return;
    const root = process.env.SystemRoot ?? process.env.windir;
    assert.ok(root !== undefined);
    const taskkill = win32.join(root, "System32", "taskkill.exe");
    const temporary = fileURLToPath(new URL("../../../tmp/", import.meta.url));
    mkdirSync(temporary, { recursive: true });
    const directory = mkdtempSync(resolve(temporary, "delayed-taskkill-"));
    const ready = resolve(directory, "ready");
    const prefix = "Deno" in globalThis ? ["run", "-A"] : [];
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    const child = spawnCliProcess(process.execPath, [
      ...prefix,
      fileURLToPath(new URL("./fixtures/cli/program.mjs", import.meta.url)),
      "tree",
      ready,
      "hang",
    ], { cwd: process.cwd(), env, detached: false });
    const waiter = createCleanupWaiter();
    const getState = observe(child, waiter.notify);
    const errors: unknown[] = [];
    child.on("error", (error: unknown) => errors.push(error));
    child.stdin.on("error", () => {});
    child.stdout.on("error", (error: unknown) => errors.push(error));
    child.stderr.on("error", (error: unknown) => errors.push(error));
    child.stdout.resume();
    child.stderr.resume();
    let descendant: number | undefined;
    try {
      const deadline = performance.now() + 5000;
      while (descendant === undefined && performance.now() < deadline) {
        try {
          const pid = Number(readFileSync(ready, "utf8"));
          if (Number.isSafeInteger(pid) && pid > 0) descendant = pid;
        } catch (error) {
          if (
            !(error instanceof Error) || !("code" in error) ||
            error.code !== "ENOENT"
          ) throw error;
        }
        if (descendant === undefined) await delay(10);
      }
      assert.ok(
        descendant !== undefined,
        "The descendant must report readiness.",
      );
      const started = performance.now();
      await cleanupCliProcess({
        child,
        mode: "tree",
        getState,
        waiter,
        recordError: (error) => errors.push(error),
      }, {
        budget: 4000,
        spawnHelper: (command, args) =>
          spawn(process.execPath, [
            ...prefix,
            fileURLToPath(
              new URL("./fixtures/cli/delayed-taskkill.mjs", import.meta.url),
            ),
            command,
            ...args,
          ], { windowsHide: true, stdio: "pipe" }),
      });
      assert.deepEqual(errors, [], inspect(errors, { depth: null }));
      assert.ok(performance.now() - started >= 1200);
      assert.ok(getState().closed);
      const descendantPid = descendant;
      assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
    } finally {
      waiter.dispose();
      for (const pid of [child.pid, descendant]) {
        if (pid === undefined) continue;
        try {
          process.kill(pid, 0);
          execFileSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
            stdio: "ignore",
            timeout: 4000,
          });
        } catch { /* Already stopped or bounded by the fixture watchdog. */ }
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("createCleanupWaiter", () => {
  it("should avoid scheduling ordinary waits at or beyond the deadline", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    assert.ok(!await waiter.waitFor(() => false, 0));
    assert.ok(!await waiter.waitFor(() => false, -1));
    assert.ok(await waiter.waitFor(() => true, 0));
    assert.equal(clock.pendingCount, 0);
    waiter.dispose();
  });

  it("should cancel notification and disposal timers without leaving pending waits", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    let complete = false;
    const notified = waiter.waitFor(() => complete, 1000);
    complete = true;
    waiter.notify();
    assert.ok(await notified);
    assert.equal(clock.pendingCount, 0);
    const disposed = waiter.waitFor(() => false, 1000);
    waiter.dispose();
    assert.ok(!await disposed);
    assert.equal(clock.pendingCount, 0);
  });

  it("should observe one zero-delay turn after draining microtasks", async () => {
    const clock = new VirtualClock();
    const waiter = createCleanupWaiter(clock);
    const order: string[] = [];
    queueMicrotask(() => order.push("microtask"));
    await clock.run(waiter.observeClose().then(() => order.push("observed")));
    assert.deepEqual(order, ["microtask", "observed"]);
    assert.equal(clock.now(), 0);
    assert.equal(clock.pendingCount, 0);
    waiter.dispose();
  });
});

// Helpers

class VirtualClock implements CleanupClock {
  time = 0;
  private sequence = 0;
  private readonly tasks = new Map<number, {
    readonly at: number;
    readonly callback: () => void;
  }>();

  get pendingCount(): number {
    return this.tasks.size;
  }

  now = (): number => this.time;

  schedule = (callback: () => void, delay: number): () => void => {
    const id = this.sequence++;
    this.tasks.set(id, { at: this.time + delay, callback });
    return () => {
      this.tasks.delete(id);
    };
  };

  async run<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    promise.then(() => settled = true, () => settled = true);
    for (let steps = 0; !settled; steps++) {
      assert.ok(steps < 100, "Cleanup must settle after bounded scheduling.");
      // Flush real stream callbacks and promise continuations without advancing
      // the injected cleanup clock.
      await nextTurn();
      if (settled) break;
      const next = [...this.tasks.entries()].sort((a, b) =>
        a[1].at - b[1].at || a[0] - b[0]
      )[0];
      assert.ok(next, "Cleanup must not wait without a notification or timer.");
      const [id, task] = next;
      this.tasks.delete(id);
      this.time = task.at;
      task.callback();
    }
    return await promise;
  }
}

class TestProcess extends EventEmitter implements CliProcess {
  readonly pid: number;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly signals: NodeJS.Signals[] = [];
  unreferenced = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.signals.push(signal);
    this.finish();
    return true;
  }

  unref(): void {
    this.unreferenced = true;
  }

  finish(code = 0): void {
    this.emit("exit", code, null);
    for (const stream of [this.stdin, this.stdout, this.stderr]) {
      stream.destroy();
      stream.emit("close");
    }
    this.emit("close", code, null);
  }
}

function observe(
  child: CliProcess,
  notify: () => void,
): () => CleanupState {
  let exited = false;
  let closed = false;
  let stdinClosed = false;
  let stdoutClosed = false;
  let stderrClosed = false;
  child.on("exit", () => {
    exited = true;
    notify();
  });
  child.on("close", () => {
    closed = true;
    notify();
  });
  child.stdin.on("close", () => {
    stdinClosed = true;
    notify();
  });
  child.stdout.on("close", () => {
    stdoutClosed = true;
    notify();
  });
  child.stderr.on("close", () => {
    stderrClosed = true;
    notify();
  });
  return () => ({ exited, closed, stdinClosed, stdoutClosed, stderrClosed });
}
