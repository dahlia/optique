import { CliInvocationError, createCliRunner } from "@optique/testing/cli";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { describe, it } from "node:test";

const fixture = new URL("./fixtures/cli/program.mjs", import.meta.url);
const runtimeArgs = "Deno" in globalThis ? ["-A"] : [];

describe("createCliRunner", () => {
  it("should capture both process streams and the exit code", async () => {
    const result = await createCliRunner({ entrypoint: fixture, runtimeArgs })
      .invoke("output");
    assert.deepEqual(result, {
      stdout: "hello\r\n한글🌻\n",
      stderr: "warning\n",
      exitCode: 0,
      signal: null,
    });
  });

  it("should classify synchronous spawn exceptions as startup failures", async () => {
    await assert.rejects(
      runner().invoke("args", "invalid\0argument"),
      (error: unknown) => {
        assert.ok(error instanceof CliInvocationError);
        assert.equal(error.reason, "spawn");
        assert.equal(error.stdout, "");
        assert.equal(error.stderr, "");
        assert.ok(error.cause instanceof TypeError);
        return true;
      },
    );
  });

  it("should reject missing executables with an invocation error", async () => {
    await assert.rejects(
      createCliRunner({ command: ["optique-nonexistent-executable-894"] })
        .invoke(),
      (error: unknown) => {
        assert.ok(error instanceof CliInvocationError);
        assert.equal(error.reason, "spawn");
        return true;
      },
    );
  });
});

describe("CLI invocation", () => {
  it("should preserve argument boundaries without shell expansion", async () => {
    const args = [
      "",
      "with spaces",
      "'quoted'",
      "$HOME",
      "a;b",
      "🌻",
      "--flag",
    ];
    const result = await runner().invoke("args", ...args);
    assert.deepEqual(JSON.parse(result.stdout), args);
  });

  it("should support commands with fixed arguments", async () => {
    const prefix = "Deno" in globalThis ? ["run", "-A"] : [];
    const result = await createCliRunner({
      command: [
        process.execPath,
        ...prefix,
        fileURLToPath(fixture),
        "args",
        "fixed",
      ],
    }).invoke({ args: ["variable"] });
    assert.deepEqual(JSON.parse(result.stdout), ["fixed", "variable"]);
  });

  it("should resolve file URLs with spaces and snapshot command arrays", async () => {
    const directory = scratch();
    try {
      const path = resolve(directory, "program with spaces.mjs");
      copyFileSync(fixture, path);
      const prefix = "Deno" in globalThis ? ["run", "-A"] : [];
      const command: [string, ...string[]] = [
        process.execPath,
        ...prefix,
        path,
        "args",
        "original",
      ];
      const cli = createCliRunner({ command });
      command[command.length - 1] = "mutated";
      assert.deepEqual(JSON.parse((await cli.invoke("value")).stdout), [
        "original",
        "value",
      ]);
      const result = await createCliRunner({
        entrypoint: pathToFileURL(path),
        runtimeArgs,
      }).invoke("output");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "hello\r\n한글🌻\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("should send EOF for absent and empty input", async () => {
    for (const stdin of [undefined, ""]) {
      const result = await runner().invoke({ args: ["stdin"], stdin });
      assert.equal(result.stdout, "");
      assert.equal(result.exitCode, 0);
    }
  });

  it("should preserve large UTF-8 input", async () => {
    const input = "한글🌻\r\n".repeat(30_000);
    assert.equal(
      (await runner().invoke({ args: ["stdin"], stdin: input })).stdout,
      input,
    );
  });

  it("should collect both large streams while writing input", async () => {
    const input = "한글🌻\r\n".repeat(30_000);
    const result = await runner().invoke({ args: ["duplex"], stdin: input });
    assert.equal(
      result.stdout,
      "o".repeat(256 * 1024) + `\n${Buffer.byteLength(input)}`,
    );
    assert.equal(result.stderr, "e".repeat(256 * 1024));
  });

  it("should time out even when the child does not read large input", async () => {
    await assert.rejects(
      runner().invoke({
        args: ["hang"],
        stdin: "x".repeat(1024 * 1024),
        timeout: 1000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliInvocationError);
        assert.equal(error.reason, "timeout");
        return true;
      },
    );
  });

  it("should preserve an early exit while input is still being written", async () => {
    const result = await runner().invoke({
      args: ["early"],
      stdin: "x".repeat(1024 * 1024),
    });
    assert.equal(result.exitCode, 7);
  });

  it("should return nonzero exit codes and uncaught exceptions", async () => {
    assert.equal((await runner().invoke("exit", "42")).exitCode, 42);
    const result = await runner().invoke("throw");
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Fixture handler failed/);
  });

  it("should report a terminating signal", {
    skip: process.platform === "win32",
  }, async () => {
    if (process.platform === "win32") return;
    const result = await runner().invoke("signal");
    assert.equal(result.exitCode, null);
    assert.equal(result.signal, "SIGTERM");
  });

  it("should snapshot factory options and resolve invocation cwd against the factory cwd", async () => {
    const directory = scratch();
    try {
      mkdirSync(resolve(directory, "nested"));
      const env = {
        OPTIQUE_CLI_FIRST: "factory",
        OPTIQUE_CLI_SECOND: "remove",
      };
      const entrypoint = new URL(fixture);
      const cli = createCliRunner({
        entrypoint,
        runtimeArgs,
        cwd: directory,
        env,
      });
      env.OPTIQUE_CLI_FIRST = "mutated";
      entrypoint.pathname = "/missing-file.mjs";
      const [first, second] = await Promise.all([
        cli.invoke({
          args: ["context"],
          cwd: "nested",
          env: { OPTIQUE_CLI_SECOND: undefined },
        }),
        cli.invoke({ args: ["context"], env: { OPTIQUE_CLI_FIRST: "call" } }),
      ]);
      assert.deepEqual(JSON.parse(first.stdout), {
        cwd: resolve(directory, "nested"),
        first: "factory",
        second: null,
        inherited: process.env.PATH ?? process.env.Path ?? null,
      });
      assert.deepEqual(JSON.parse(second.stdout), {
        cwd: directory,
        first: "call",
        second: "remove",
        inherited: process.env.PATH ?? process.env.Path ?? null,
      });
      assert.equal(process.env.OPTIQUE_CLI_FIRST, undefined);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("should reject invalid timeout values", async () => {
    for (const timeout of [-1, 0.5, NaN, Infinity, 2147483648]) {
      assert.throws(
        () => createCliRunner({ entrypoint: fixture, timeout }),
        RangeError,
      );
      await assert.rejects(runner().invoke({ timeout }), RangeError);
    }
  });

  it("should remove variables inherited from the parent environment", async () => {
    const previous = process.env.OPTIQUE_CLI_SECOND;
    process.env.OPTIQUE_CLI_SECOND = "inherited";
    try {
      const result = await runner().invoke({
        args: ["context"],
        env: { OPTIQUE_CLI_SECOND: undefined },
      });
      assert.equal(JSON.parse(result.stdout).second, null);
      assert.equal(process.env.OPTIQUE_CLI_SECOND, "inherited");
    } finally {
      if (previous === undefined) delete process.env.OPTIQUE_CLI_SECOND;
      else process.env.OPTIQUE_CLI_SECOND = previous;
    }
  });

  it("should reject invalid execution forms", () => {
    // @ts-expect-error An execution target is required.
    assert.throws(() => createCliRunner({}), TypeError);
    // @ts-expect-error Commands require an executable.
    assert.throws(() => createCliRunner({ command: [] }), TypeError);
    assert.throws(
      // @ts-expect-error Execution targets are mutually exclusive.
      () => createCliRunner({ entrypoint: fixture, command: ["node"] }),
      TypeError,
    );
    assert.throws(
      // @ts-expect-error runtimeArgs is only for entrypoints.
      () => createCliRunner({ command: ["node"], runtimeArgs: [] }),
      TypeError,
    );
  });

  it("should reject malformed invocation options asynchronously", async () => {
    // @ts-expect-error Invocation options must be an object or strings.
    const promise = runner().invoke(42);
    assert.ok(promise instanceof Promise);
    await assert.rejects(promise, TypeError);
    // @ts-expect-error Cleanup policies are a closed set.
    await assert.rejects(runner().invoke({ cleanup: "all" }), TypeError);
    await assert.rejects(
      // @ts-expect-error Standard input is a UTF-8 string.
      runner().invoke({ stdin: new Uint8Array() }),
      TypeError,
    );
  });

  it("should classify a nonexistent working directory as a spawn failure", async () => {
    await assert.rejects(
      runner().invoke({
        cwd: fileURLToPath(new URL("./missing-894/", fixture)),
      }),
      (error: unknown) => {
        assert.ok(error instanceof CliInvocationError);
        assert.equal(error.reason, "spawn");
        assert.equal(error.stdout, "");
        assert.ok(error.cause);
        return true;
      },
    );
  });

  it("should reject pre-aborted calls without starting a process", async () => {
    await assert.rejects(
      createCliRunner({
        command: ["missing-894"],
        signal: AbortSignal.abort("cancelled"),
      }).invoke(),
      (error: unknown) => {
        assert.ok(error instanceof CliInvocationError);
        assert.equal(error.reason, "aborted");
        assert.equal(error.stdout, "");
        return true;
      },
    );
  });

  it("should let invocation signals and timeout replace factory defaults", async () => {
    const cli = createCliRunner({
      entrypoint: fixture,
      runtimeArgs,
      timeout: 1,
      signal: AbortSignal.abort(),
    });
    const result = await cli.invoke({
      args: ["output"],
      signal: new AbortController().signal,
      timeout: 0,
    });
    assert.equal(result.exitCode, 0);
  });

  it("should abort an active process and retain its output", async () => {
    const directory = scratch();
    const ready = resolve(directory, "ready");
    const controller = new AbortController();
    const invocation = runner().invoke({
      args: ["hang", ready],
      signal: controller.signal,
    });
    const settled = invocation.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      const pid = await waitReady(ready);
      controller.abort("test cancellation");
      const result = await settled;
      assert.ok("error" in result);
      assert.ok(result.error instanceof CliInvocationError);
      assert.equal(result.error.reason, "aborted");
      assert.equal(result.error.stdout, "ready\n");
      assert.equal(result.error.stderr, "waiting\n");
      assert.ok(!alive(pid));
    } finally {
      controller.abort();
      await settled;
      killFixture(ready);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("should time out a child and retain its partial output", async () => {
    await assert.rejects(
      runner().invoke({ args: ["hang"], timeout: 1000 }),
      (error: unknown) => {
        assert.ok(error instanceof CliInvocationError);
        assert.equal(error.reason, "timeout");
        assert.equal(error.stdout, "ready\n");
        assert.equal(error.stderr, "waiting\n");
        return true;
      },
    );
  });
});

function runner() {
  return createCliRunner({ entrypoint: fixture, runtimeArgs });
}

function scratch(): string {
  const directory = fileURLToPath(new URL("../../../../tmp/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  return mkdtempSync(resolve(directory, "cli-"));
}

async function waitReady(path: string): Promise<number> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const pid = Number(readFileSync(path, "utf8"));
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch { /* The fixture has not announced readiness yet. */ }
    await delay(10);
  }
  throw new Error("CLI fixture did not become ready.");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
  if (process.platform === "linux") {
    // Deno protects /proc even with --allow-read.  Query ps through the already
    // required --allow-run permission, and distinguish unreaped zombies from
    // executing processes without silently swallowing permission failures.
    try {
      const status = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return status !== "" && !status.startsWith("Z");
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 1) {
        return false;
      }
      throw error;
    }
  }
  return true;
}

function killFixture(path: string): void {
  try {
    process.kill(Number(readFileSync(path, "utf8")), "SIGKILL");
  } catch { /* The runner may already have stopped the fixture. */ }
}

describe("CLI process cleanup", () => {
  it("should drain output written while responding to cancellation", {
    skip: process.platform === "win32",
  }, async () => {
    if (process.platform === "win32") return;
    const directory = scratch();
    const ready = resolve(directory, "ready");
    const controller = new AbortController();
    const settled = runner().invoke({
      args: ["graceful", ready],
      signal: controller.signal,
    }).then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await waitReady(ready);
      controller.abort();
      const result = await settled;
      assert.ok("error" in result);
      assert.ok(result.error instanceof CliInvocationError);
      assert.equal(result.error.reason, "aborted");
      assert.equal(result.error.stderr, "waiting\n" + "final\n".repeat(10_000));
    } finally {
      controller.abort();
      await settled;
      killFixture(ready);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  for (const parent of ["hang", "exit"]) {
    it(`should stop stubborn descendants when the parent will ${parent}`, {
      skip: process.platform === "win32",
    }, async () => {
      if (process.platform === "win32") return;
      const directory = scratch();
      const ready = resolve(directory, "ready");
      const controller = new AbortController();
      const invocation = runner().invoke({
        args: ["tree", ready, parent, resolve(directory, "parent")],
        cleanup: "tree",
        signal: controller.signal,
        timeout: 8000,
      });
      const settled = invocation.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      try {
        const pid = await waitReady(ready);
        if (parent === "exit") {
          const parentPid = await waitReady(resolve(directory, "parent"));
          const deadline = Date.now() + 5000;
          while (alive(parentPid) && Date.now() < deadline) await delay(10);
          assert.ok(
            !alive(parentPid),
            "The root must exit before cancellation.",
          );
        }
        controller.abort();
        const result = await settled;
        assert.ok("error" in result);
        assert.ok(result.error instanceof CliInvocationError);
        assert.equal(result.error.reason, "aborted");
        assert.equal(result.error.stdout, "ready\n");
        // SIGKILL delivery may finish just after the direct child's streams
        // close; allow the operating system to complete that transition.
        const deadline = Date.now() + 1000;
        while (alive(pid) && Date.now() < deadline) await delay(10);
        assert.ok(!alive(pid), "The stubborn descendant must no longer run.");
      } finally {
        controller.abort();
        await settled;
        killFixture(ready);
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  it("should leave descendants alive with the default child-only cleanup", {
    skip: process.platform === "win32",
  }, async () => {
    if (process.platform === "win32") return;
    const directory = scratch();
    const ready = resolve(directory, "ready");
    const controller = new AbortController();
    const settled = runner().invoke({
      args: ["tree", ready, "hang"],
      signal: controller.signal,
    })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      const pid = await waitReady(ready);
      controller.abort();
      const result = await settled;
      assert.ok("error" in result);
      assert.ok(result.error instanceof CliInvocationError);
      assert.equal(result.error.reason, "aborted");
      assert.ok(alive(pid), "Child-only cleanup must not kill a descendant.");
    } finally {
      controller.abort();
      await settled;
      killFixture(ready);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("should stop descendants on Windows with tree cleanup", {
    skip: process.platform !== "win32",
  }, async () => {
    if (process.platform !== "win32") return;
    const directory = scratch();
    const ready = resolve(directory, "ready");
    const controller = new AbortController();
    const settled = runner().invoke({
      args: ["tree", ready, "hang"],
      cleanup: "tree",
      signal: controller.signal,
    })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      const pid = await waitReady(ready);
      controller.abort();
      const result = await settled;
      assert.ok("error" in result);
      assert.ok(result.error instanceof CliInvocationError);
      assert.equal(result.error.reason, "aborted");
      assert.ok(!alive(pid));
    } finally {
      controller.abort();
      await settled;
      killFixture(ready);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Optique CLI entrypoints", () => {
  const application = new URL(
    "./fixtures/cli/application.mjs",
    import.meta.url,
  );
  it("should capture help, version, and parsing failures without exiting the test", async () => {
    const cli = createCliRunner({ entrypoint: application, runtimeArgs });
    const help = await cli.invoke("--help");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /fixture-app/);
    const version = await cli.invoke("--version");
    assert.equal(version.exitCode, 0);
    assert.equal(version.stdout, "1.2.3\n");
    const failure = await cli.invoke();
    assert.notEqual(failure.exitCode, 0);
    assert.notEqual(failure.stderr, "");
  });

  it("should capture console, print, and raw process output", async () => {
    const result = await createCliRunner({
      entrypoint: application,
      runtimeArgs,
    }).invoke("Ada");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'console:Ada\nprint:"Ada"\nraw\n');
    assert.equal(result.stderr, "");
  });
});

describe("Windows CLI failures", () => {
  it("should override and remove environment keys without case sensitivity", {
    skip: process.platform !== "win32",
  }, async () => {
    if (process.platform !== "win32") return;
    const cli = createCliRunner({
      entrypoint: fixture,
      runtimeArgs,
      env: { OPTIQUE_CLI_FIRST: "factory", OPTIQUE_CLI_SECOND: "factory" },
    });
    const result = await cli.invoke({
      args: ["context"],
      env: { optique_cli_first: "call", optique_cli_second: undefined },
    });
    const context = JSON.parse(result.stdout);
    assert.equal(context.first, "call");
    assert.equal(context.second, null);
  });

  it("should report taskkill failures without losing the original timeout", {
    skip: process.platform !== "win32",
  }, async () => {
    if (process.platform !== "win32") return;
    const directory = scratch();
    const ready = resolve(directory, "ready");
    try {
      const result = await createCliRunner({
        entrypoint: new URL(
          "./fixtures/cli/windows-cleanup.mjs",
          import.meta.url,
        ),
        runtimeArgs,
        timeout: 10_000,
      }).invoke(ready);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        reason: "cleanup",
        stdout: "ready\n",
        aggregate: true,
      });
    } finally {
      killFixture(ready);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
