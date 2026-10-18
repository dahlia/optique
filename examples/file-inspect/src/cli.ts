#!/usr/bin/env node
import { runProgram } from "@optique/discover";
import process from "node:process";
import type { InputScope } from "./input.ts";
import { createFileProgram } from "./program.ts";

try {
  await runProgram<InputScope>(createFileProgram());
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`file-inspect: ${reason.replace(/[\r\n]+/g, " ")}\n`);
  process.exitCode = 1;
}
