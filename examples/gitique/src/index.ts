#!/usr/bin/env node
import { or } from "@optique/core/constructs";
import { printError, run } from "@optique/run";
import { message } from "@optique/core/message";
import { addCommand, executeAdd } from "./commands/add.ts";
import { commitCommand, executeCommit } from "./commands/commit.ts";
import { diffCommand, executeDiff } from "./commands/diff.ts";
import { executeLog, logCommand } from "./commands/log.ts";
import { executeReset, resetCommand } from "./commands/reset.ts";
import { executeStatus, statusCommand } from "./commands/status.ts";

/**
 * Main CLI parser that combines all git commands using Optique's or() combinator.
 * This creates a type-safe union of all possible command configurations.
 *
 * Commands demonstrate various Optique features:
 * - add: group(), merge(), multiple()
 * - commit: group(), merge(), optional()
 * - diff: group(), merge(), choice(), withDefault(), multiple() with max
 * - log: group(), merge(), choice(), withDefault(), map()
 * - reset: group(), merge(), choice(), withDefault(), map()
 * - status: group(), merge(), choice(), withDefault(), map()
 */
const parser = or(
  addCommand,
  commitCommand,
  diffCommand,
  logCommand,
  resetCommand,
  statusCommand,
);

/**
 * Execute the gitique CLI with comprehensive error handling and help support.
 * Uses @optique/run for automatic process integration including:
 * - Argument parsing from process.argv
 * - Terminal color detection
 * - Help command generation
 * - Process exit handling
 * - Shell completion script generation
 */
async function main() {
  try {
    const result = run(parser, {
      programName: "gitique",
      help: "both", // Enable both --help option and help command
      completion: "both", // Enable both completion command and --completion option
      aboveError: "usage", // Show usage information above error messages
      colors: true, // Force colored output for better UX
      showDefault: true, // Display default values in help text
      brief: message`A Git-like CLI built with Optique`,
      footer:
        message`For more information, visit https://github.com/dahlia/optique`,
    });

    // Execute the appropriate command based on the discriminated union tag
    switch (result.command) {
      case "add":
        await executeAdd(result);
        break;
      case "commit":
        await executeCommit(result);
        break;
      case "diff":
        await executeDiff(result);
        break;
      case "log":
        await executeLog(result);
        break;
      case "reset":
        await executeReset(result);
        break;
      case "status":
        await executeStatus(result);
        break;
      default: {
        // TypeScript will ensure this is never reached if all cases are covered
        const _exhaustive: never = result;
        printError(message`Unknown command.`, { exitCode: 1 });
      }
    }
  } catch (error) {
    printError(
      message`${error instanceof Error ? error.message : String(error)}.`,
      { exitCode: 1 },
    );
  }
}

// Run the main function
main();
