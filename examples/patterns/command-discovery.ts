import { message } from "@optique/core/message";
import { runProgram } from "@optique/discover";
import process from "node:process";

// This example shows how @optique/discover can turn a directory of command
// modules into a runnable CLI.  Each file under command-discovery/ exports a
// defineCommand() result with its parser, metadata, and handler.
//
// Usage:
//   deno run -A examples/patterns/command-discovery.ts build --target web
//   deno run -A examples/patterns/command-discovery.ts deploy --env staging
//   deno run -A examples/patterns/command-discovery.ts --help

await runProgram({
  dir: new URL("./command-discovery/", import.meta.url),
  metadata: {
    name: "tasks",
    version: "1.0.0",
    brief: message`Project task runner.`,
    description:
      message`A small task runner whose commands are discovered from files.`,
  },
  args: process.argv.slice(2),
  showDefault: true,
  showChoices: true,
});
