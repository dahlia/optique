import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version) throw new TypeError("A version is required.");
const path = new URL("../packages/core/deno.json", import.meta.url);
const metadata = JSON.parse(await readFile(path, "utf8"));
metadata.version = version;
await writeFile(path, JSON.stringify(metadata, null, 2) + "\n");
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./check_versions.ts", import.meta.url)), "--fix"],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
