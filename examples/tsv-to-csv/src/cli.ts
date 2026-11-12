#!/usr/bin/env node
import process from "node:process";
import { run } from "@optique/run";
import { convertFile, program } from "./app.ts";
import { confirmOverwrite } from "./confirm.ts";

// run() exits the process for --help, --version, and parse errors, so none
// of the code below runs for them: no file is read or written, and no
// prompt is shown.
const options = run(program, {
  help: "option",
  version: program.metadata.version,
});

process.exitCode = await convertFile(options, {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  // Ask only when a person can answer.  In scripts and pipelines, an
  // existing destination is refused instead of waiting for input.
  confirm: process.stdin.isTTY && process.stderr.isTTY
    ? (output) =>
      confirmOverwrite(output, {
        input: process.stdin,
        output: process.stderr,
      })
    : undefined,
});
