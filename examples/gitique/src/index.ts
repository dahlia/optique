#!/usr/bin/env node
import { run } from "@optique/run";
import { or } from "@optique/core/parser";
import process from "node:process";
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
        console.error("Unknown command");
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

// Run the main function
main();
