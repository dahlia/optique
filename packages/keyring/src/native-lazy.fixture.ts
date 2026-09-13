import assert from "node:assert/strict";
import { seq } from "@optique/core/constructs";
import { runWith } from "@optique/core/facade";
import { parseAsync, suggestAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { bindKeyring, createKeyringContext } from "#src/index.ts";

const context = createKeyringContext();
const parser = bindKeyring(option("--password", string()), {
  context,
  service: "example.test",
  username: "alice",
});
const annotations = await context.getAnnotations();

const cliResult = await parseAsync(parser, ["--password", "cli-value"], {
  annotations,
});
assert.ok(cliResult.success);
assert.equal(cliResult.value, "cli-value");

const sequenceResult = await parseAsync(
  seq(parser, option("--other", string())),
  ["--password", "cli-value", "--other", "other-value"],
  { annotations },
);
assert.deepEqual(sequenceResult, {
  success: true,
  value: ["cli-value", "other-value"],
});

const envContext = createEnvContext({ source: () => "env-value" });
const envResult = await runWith(
  bindEnv(parser, { context: envContext, key: "PASSWORD", parser: string() }),
  "test",
  [envContext, context],
  { args: [] },
);
assert.equal(envResult, "env-value");

const help = await runWith(parser, "test", [context], {
  args: ["--help"],
  help: { option: true, onShow: () => "help" },
  stdout: () => {},
  stderr: () => {},
});
assert.equal(help, "help");

const version = await runWith(parser, "test", [context], {
  args: ["--version"],
  version: { value: "1.0.0", option: true, onShow: () => "version" },
  stdout: () => {},
  stderr: () => {},
});
assert.equal(version, "version");

await suggestAsync(parser, ["--"], { annotations });

await assert.rejects(
  parseAsync(parser, [], { annotations }),
  (error: unknown) =>
    error instanceof Error &&
    (process.platform === "linux"
      ? "code" in error && error.code === "ENOENT"
      : error.message.startsWith("Cannot find native binding.")),
);
