#!/usr/bin/env node
import { runProgram } from "@optique/discover";
import process from "node:process";
import type { InputScope } from "./input.ts";
import { createFileProgram } from "./program.ts";

try {
  await runProgram<InputScope>(createFileProgram());
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const printableReason = reason.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) =>
      character.split("").map((unit) =>
        `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`
      ).join(""),
  );
  process.stderr.write(`file-inspect: ${printableReason}\n`);
  process.exitCode = 1;
}
