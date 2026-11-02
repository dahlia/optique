import process from "node:process";
import { or } from "@optique/core/constructs";
import { command } from "@optique/core/primitives";
import { map } from "@optique/core/modifiers";
import { run } from "@optique/run";
import { options, set, start, status } from "./grammar.js";

const parser = or(
  command("start", map(start(), (value) => ({ command: "start", ...value }))),
  command(
    "status",
    map(status(), (value) => ({ command: "status", ...value })),
  ),
  command(
    "config",
    command(
      "set",
      map(set(), (value) => ({ command: "config set", ...value })),
    ),
  ),
);
process.stdout.write(`${JSON.stringify(run(parser, options))}\n`);
