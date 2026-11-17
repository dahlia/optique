import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// This is an explicit compatibility smoke, not part of Node-only test discovery.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const packages = ["@logtape/logtape", "isomorphic-git", "@napi-rs/keyring"];
const resolutions = packages.map((name) => require.resolve(name));
const before = snapshot();
const result = spawnSync("mise", ["run", "setup:deno"], {
  cwd: root,
  encoding: "utf8",
  timeout: 120_000,
});
assert.ifError(result.error);
assert.equal(result.status, 0, result.stdout + result.stderr);
assert.deepEqual(snapshot(), before, "Deno setup changed pnpm-managed files.");
assert.deepEqual(
  packages.map((name) => require.resolve(name)),
  resolutions,
);
console.log(
  `Deno setup preserved ${Object.keys(before).length} dependency entries.`,
);

function snapshot(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (
    const path of globSync([
      "node_modules",
      "packages/*/node_modules",
      "examples/*/node_modules",
      "docs/node_modules",
      "benchmarks/startup/node_modules",
    ], { cwd: root })
  ) {
    const directory = join(root, path);
    scan(directory);
    entries[`${path}/.deno`] = String(existsSync(join(directory, ".deno")));
    const metadata = join(directory, ".modules.yaml");
    if (existsSync(metadata)) hash(metadata);
  }
  for (const name of ["pnpm-lock.yaml", "deno.lock"]) hash(join(root, name));
  return entries;

  function scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        entries[relative(root, path)] = `link:${readlinkSync(path)}`;
      } else if (
        entry.isDirectory() &&
        (entry.name.startsWith("@") || entry.name === ".bin")
      ) {
        scan(path);
      } else if (entry.isFile() && directory.endsWith(".bin")) {
        hash(path);
      }
    }
  }

  function hash(path: string): void {
    entries[relative(root, path)] = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
  }
}
