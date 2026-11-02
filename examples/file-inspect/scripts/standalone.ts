import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(root, "dist/package/cli.js");
const output = resolve(root, "dist/file-inspect");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const inputSha256 = hash(await readFile(input));
const command = [
  "build",
  "--compile",
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
  "dist/package/cli.js",
  "--outfile",
  "dist/file-inspect",
];
const compiler = execFileSync("bun", ["--version"], { encoding: "utf8" })
  .trim();
execFileSync("bun", command, { cwd: root, stdio: "inherit" });
assert.equal(hash(await readFile(input)), inputSha256);
await writeFile(
  resolve(root, "dist/standalone-evidence.json"),
  JSON.stringify(
    {
      command: ["bun", ...command],
      compiler,
      inputSha256,
      outputSha256: hash(await readFile(output)),
    },
    null,
    2,
  ) + "\n",
);
