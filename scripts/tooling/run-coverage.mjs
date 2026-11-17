import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runChild, validateLcov } from "./coverage.mjs";

const root = process.cwd();
if (
  process.argv.length > 3 || process.argv[2] && process.argv[2] !== "--smoke"
) {
  throw new TypeError("Expected no argument or --smoke.");
}
const directory = resolve(root, "coverage");
// Only this task's bounded report tree is reset. Public builds stay untouched.
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  await runChild({
    cwd: root,
    args: [
      fileURLToPath(import.meta.resolve("c8/bin/c8.js")),
      "--reporter=text",
      "--reporter=lcovonly",
      "--extension=.ts",
      "--all",
      "--src=packages",
      "--include=packages/*/src/**/*.ts",
      "--exclude=**/*.test.ts",
      "--exclude=**/*.fixture.ts",
      "--exclude=**/fixtures/**",
      "--exclude=**/test-fixtures/**",
      "--exclude=**/generated/**",
      "--exclude=**/*.d.ts",
      `--reports-dir=${directory}`,
      `--temp-directory=${resolve(directory, "raw")}`,
      "node",
      "scripts/tooling/coverage-runner.mjs",
      ...process.argv.slice(2),
    ],
  }, { signal: controller.signal });
  validateLcov(readFileSync(resolve(directory, "lcov.info"), "utf8"), root);
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
