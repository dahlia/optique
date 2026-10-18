import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { createCliRunner } from "@optique/testing/cli";
import manifest from "../package.json" with { type: "json" };

const entrypoint = new URL("./cli.ts", import.meta.url);
const runtimeArgs = "Deno" in globalThis ? ["--allow-read", "--allow-env"] : [];
const env = {
  FORCE_COLOR: undefined,
  CLICOLOR_FORCE: undefined,
  NO_COLOR: undefined,
  NODE_DISABLE_COLORS: undefined,
  NODE_OPTIONS: undefined,
  NODE_PATH: undefined,
  COLUMNS: "80",
  TERM: "dumb",
};

async function fixture(test: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "file-inspect-cli-"));
  try {
    await writeFile(join(directory, "sample.txt"), "one\ntwo\n");
    await test(directory);
    assert.equal(
      await readFile(join(directory, "sample.txt"), "utf8"),
      "one\ntwo\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it("runs the actual entry point and separates stdout from stderr", () =>
  fixture(async (cwd) => {
    const cli = createCliRunner({ entrypoint, runtimeArgs, env, cwd });
    assert.deepEqual(await cli.invoke("file", "info", "sample.txt"), {
      stdout: '{"path":"sample.txt","bytes":8}\n',
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    assert.equal(
      (await cli.invoke("file", "lines", "sample.txt")).stdout,
      "2\n",
    );
    const help = await cli.invoke("--help");
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /Usage: file-inspect/);
    assert.ok(!help.stdout.includes("\x1b["));
    assert.equal(help.stderr, "");
    assert.equal(
      (await cli.invoke("--version")).stdout,
      `${manifest.version}\n`,
    );
  }));

it("reports parse and missing-file errors without ANSI or stack traces", () =>
  fixture(async (cwd) => {
    const cli = createCliRunner({ entrypoint, runtimeArgs, env, cwd });
    for (
      const args of [
        ["file", "lines"],
        ["file", "lines", "sample.txt", "extra"],
        ["file", "info", "-"],
        ["file", "info", ""],
        ["--unknown"],
        ["file", "info", "missing.txt"],
      ]
    ) {
      const result = await cli.invoke(...args);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.length > 0);
      assert.ok(!result.stderr.includes("\x1b["));
      assert.doesNotMatch(result.stderr, /\n\s+at /);
      if (args.at(-1) === "") assert.match(result.stderr, /nonempty file path/);
      if (args.includes("missing.txt")) {
        assert.match(result.stderr, /^file-inspect:/);
      }
    }
  }));

it("escapes terminal controls in filesystem error messages", () =>
  fixture(async (cwd) => {
    const cli = createCliRunner({ entrypoint, runtimeArgs, env, cwd });
    const result = await cli.invoke(
      "file",
      "info",
      "missing\x1b[31m\x1b]0;title\x07\b\t\r\n\x7f\x85.txt",
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^file-inspect: .*missing/);
    assert.ok(result.stderr.endsWith("\n"));
    // Only the final diagnostic newline may contain a control character.
    // deno-lint-ignore no-control-regex
    assert.doesNotMatch(result.stderr.slice(0, -1), /[\x00-\x1f\x7f-\x9f]/);
  }));

it("escapes Unicode format characters in filesystem errors", () =>
  fixture(async (cwd) => {
    const cli = createCliRunner({ entrypoint, runtimeArgs, env, cwd });
    const result = await cli.invoke(
      "file",
      "info",
      "missing\u202e\u2066\u{e0001}.txt",
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /\p{Cf}/u);
    assert.ok(result.stderr.includes("\\u202e"));
    assert.ok(result.stderr.includes("\\u2066"));
    assert.ok(result.stderr.includes("\\udb40\\udc01"));
  }));

it("consumes explicit stdin and terminates after EOF", () =>
  fixture(async (cwd) => {
    const cli = createCliRunner({ entrypoint, runtimeArgs, env, cwd });
    for (
      const [stdin, stdout] of [["", "0\n"], ["one\ntwo", "2\n"], [
        "a\r\nb\r\n",
        "2\n",
      ]]
    ) {
      assert.deepEqual(
        await cli.invoke({ args: ["file", "lines", "-"], stdin }),
        {
          stdout,
          stderr: "",
          exitCode: 0,
          signal: null,
        },
      );
    }
  }));

it("finishes file, help, version and invalid invocations while stdin stays open", () =>
  fixture(async (cwd) => {
    for (
      const args of [
        ["file", "info", "sample.txt"],
        ["file", "lines", "sample.txt"],
        ["--help"],
        ["--version"],
        ["--unknown"],
      ]
    ) {
      const child = spawn(process.execPath, [
        ...("Deno" in globalThis ? ["run", ...runtimeArgs] : []),
        fileURLToPath(entrypoint),
        ...args,
      ], {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      child.stdin.on("error", () => {});
      child.stdout.resume();
      child.stderr.resume();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
          timer = setTimeout(() => {
            child.kill();
            reject(
              new Error(
                `Invocation waited for unopened stdin: ${args.join(" ")}`,
              ),
            );
          }, 10_000);
        });
        assert.equal(code, args[0] === "--unknown" ? 1 : 0);
      } finally {
        clearTimeout(timer);
        child.stdin.destroy();
      }
    }
  }));

it("rejects a FIFO without waiting for a writer", {
  skip: process.platform !== "linux",
}, async () => {
  if (process.platform !== "linux") return;
  await fixture(async (cwd) => {
    execFileSync("mkfifo", [join(cwd, "input.fifo")]);
    const cli = createCliRunner({
      entrypoint,
      runtimeArgs,
      env,
      cwd,
      timeout: 2000,
    });
    for (const command of ["info", "lines"]) {
      const result = await cli.invoke("file", command, "input.fifo");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /regular file/);
    }
  });
});

it("reports stdout failure through the concise handler error boundary", {
  skip: process.platform !== "linux",
}, async () => {
  if (process.platform !== "linux") return;
  await fixture(async (cwd) => {
    const cli = createCliRunner({
      command: [
        "bash",
        "--norc",
        "--noprofile",
        "-c",
        'exec "$@" > /dev/full',
        "bash",
        process.execPath,
        ...("Deno" in globalThis ? ["run", ...runtimeArgs] : []),
        fileURLToPath(entrypoint),
      ],
      env,
      cwd,
    });
    const result = await cli.invoke("file", "lines", "sample.txt");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^file-inspect:/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  });
});
