#!/usr/bin/env node
import { or } from "@optique/core/constructs";
import { printError, run } from "@optique/run";
import { message } from "@optique/core/message";
import { addCommand, executeAdd } from "./commands/add.ts";
import { commitCommand, executeCommit } from "./commands/commit.ts";
import { executeLog, logCommand } from "./commands/log.ts";
import { executeReset, resetCommand } from "./commands/reset.ts";

/**
 * Main CLI parser that combines all git commands using Optique's or() combinator.
 * This creates a type-safe union of all possible command configurations.
 */
const parser = or(
  addCommand,
  commitCommand,
  logCommand,
  resetCommand,
);

/**
 * Execute the gitique CLI with comprehensive error handling and help support.
 * Uses @optique/run for automatic process integration including:
 * - Argument parsing from process.argv
 * - Terminal color detection
 * - Help command generation
 * - Process exit handling
 */
async function main() {
  try {
    const result = run(parser, {
      programName: "gitique",
      help: "both", // Enable both --help option and help command
      completion: "both", // Enable both completion command and --completion option
      aboveError: "usage", // Show usage information above error messages
      colors: true, // Force colored output for better UX
    });

    // Execute the appropriate command based on the discrimination tag
    switch (result.command) {
      case "add":
        await executeAdd(result);
        break;
      case "commit":
        await executeCommit(result);
        break;
      case "log":
        await executeLog(result);
        break;
      case "reset":
        await executeReset(result);
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
