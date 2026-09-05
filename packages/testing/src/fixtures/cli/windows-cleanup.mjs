import { CliInvocationError, createCliRunner } from "@optique/testing/cli";
import { readFileSync } from "node:fs";

const systemRoot = process.env.SystemRoot;
const windir = process.env.windir;
const ready = process.argv[2];
// Isolate the broken cleanup environment from the test runner and restore the
// actual Windows system paths in the target's environment so it can start.
for (const key of Object.keys(process.env)) {
  if (["systemroot", "windir"].includes(key.toLowerCase())) {
    delete process.env[key];
  }
}
process.env.SystemRoot = "Z:\\optique-missing-system-directory-894";
process.env.windir = "Z:\\optique-missing-system-directory-894";
try {
  await createCliRunner({
    entrypoint: new URL("./program.mjs", import.meta.url),
    runtimeArgs: "Deno" in globalThis ? ["-A"] : [],
    env: { SystemRoot: systemRoot, windir },
    cleanup: "tree",
    timeout: 4000,
  }).invoke("tree", ready, "hang");
  throw new Error("Expected tree cleanup to fail.");
} catch (error) {
  if (!(error instanceof CliInvocationError)) throw error;
  console.log(JSON.stringify({
    reason: error.reason,
    stdout: error.stdout,
    aggregate: error.cause instanceof AggregateError,
  }));
} finally {
  try {
    process.kill(Number(readFileSync(ready, "utf8")), "SIGKILL");
  } catch { /* The descendant may already have exited. */ }
}
