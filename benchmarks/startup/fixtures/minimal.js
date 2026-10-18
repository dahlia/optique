import process from "node:process";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { withDefault } from "@optique/core/modifiers";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run/run";

const value = run(
  object({ name: withDefault(option("--name", string()), "world") }),
  {
    programName: "minimal",
    help: "both",
    colors: false,
    maxWidth: 80,
    showDefault: true,
  },
);
process.stdout.write(`${JSON.stringify(value)}\n`);
