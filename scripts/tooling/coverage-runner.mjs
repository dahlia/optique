import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runChild,
  testCommand,
  testPlans,
  validateJunit,
} from "./coverage.mjs";

const root = process.cwd();
const smoke = process.argv[2] === "--smoke";
if (process.argv.length > (smoke ? 3 : 2)) {
  throw new TypeError("Unexpected coverage arguments.");
}
const plans = smoke
  ? [{
    directory: "packages/temporal",
    script: "node --test src/index.test.ts",
  }]
  : testPlans(root);
mkdirSync(resolve(root, "coverage/junit"), { recursive: true });
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
const preload =
  pathToFileURL(resolve(root, "scripts/tooling/source-hook.mjs")).href;
const env = {
  ...process.env,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`,
};
try {
  for (const [index, plan] of plans.entries()) {
    await runChild(testCommand(root, plan, index), {
      env,
      signal: controller.signal,
    });
    validateJunit(
      readFileSync(resolve(root, "coverage/junit", `${index}.xml`), "utf8"),
    );
  }
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
