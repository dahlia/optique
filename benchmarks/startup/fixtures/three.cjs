const process = require("node:process");
const { or } = require("@optique/core/constructs");
const { command } = require("@optique/core/primitives");
const { map } = require("@optique/core/modifiers");
const { run } = require("@optique/run");
const { options, set, start, status } = require("./grammar.cjs");

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
