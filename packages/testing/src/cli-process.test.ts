import assert from "node:assert/strict";
import { once } from "node:events";
import process from "node:process";
import type { Readable } from "node:stream";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnDenoProcess } from "./cli-process.ts";

const isDeno = "Deno" in globalThis;
const fixture = fileURLToPath(
  new URL("./fixtures/cli/program.mjs", import.meta.url),
);

function start(mode: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const child = spawnDenoProcess(
    process.execPath,
    ["run", "-A", fixture, mode],
    {
      cwd: process.cwd(),
      env,
      detached: false,
    },
  );
  assert.ok(child);
  return child;
}

async function text(stream: Readable): Promise<string> {
  stream.setEncoding("utf8");
  let result = "";
  for await (const chunk of stream) result += chunk;
  return result;
}

describe("native Deno CLI pipes", () => {
  for (const mode of ["stdin", "duplex"]) {
    it(
      `should complete large ${mode} transfers`,
      { skip: !isDeno },
      async () => {
        if (!isDeno) return;
        const child = start(mode);
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        try {
          const closed = once(child, "close");
          const output = text(child.stdout);
          const errors = text(child.stderr);
          const input = "한글🌻\r\n".repeat(30_000);
          child.stdin.end(input);
          const [stdout, stderr] = await Promise.all([output, errors, closed]);
          assert.equal(
            stdout,
            mode === "stdin"
              ? input
              : "o".repeat(256 * 1024) + `\n${Buffer.byteLength(input)}`,
          );
          assert.equal(stderr, mode === "stdin" ? "" : "e".repeat(256 * 1024));
        } finally {
          clearTimeout(timer);
        }
      },
    );
  }

  it(
    "should keep timers responsive while input is blocked",
    { skip: !isDeno },
    async () => {
      if (!isDeno) return;
      const child = start("hang");
      const closed = once(child, "close");
      const output = text(child.stdout);
      const errors = text(child.stderr);
      child.stdin.on("error", () => {});
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 500);
      try {
        child.stdin.end("x".repeat(1024 * 1024));
        await Promise.all([output, errors, closed]);
        assert.ok(timedOut);
      } finally {
        clearTimeout(timer);
      }
    },
  );
});
