import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ownedFiles } from "./files.mjs";

const result = spawnSync(
  "node",
  [
    fileURLToPath(
      new URL("bin/oxlint", import.meta.resolve("oxlint/package.json")),
    ),
    "--deny-warnings",
    "--report-unused-disable-directives-severity=error",
    ...ownedFiles(process.cwd(), "lint"),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
