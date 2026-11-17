import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ownedFiles } from "./files.mjs";

const mode = process.argv[2];
if (
  !["--list", "--check", "--write"].includes(mode) || process.argv.length !== 3
) {
  throw new TypeError("Expected exactly --list, --check or --write.");
}
const files = ownedFiles(process.cwd(), "format");
if (mode === "--list") console.log(files.join("\n"));
else {
  const result = spawnSync("node", [
    fileURLToPath(
      new URL("bin/oxfmt", import.meta.resolve("oxfmt/package.json")),
    ),
    mode,
    ...files,
  ], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
