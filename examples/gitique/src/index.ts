#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import process from "node:process";
import { or } from "@optique/core/constructs";
import { defineProgram } from "@optique/core/program";
import { commandLine, lineBreak, message, url } from "@optique/core/message";
import { run } from "@optique/run";
import { addCommand, executeAdd } from "./commands/add.ts";
import { commitCommand, executeCommit } from "./commands/commit.ts";
import { diffCommand, executeDiff } from "./commands/diff.ts";
import { executeLog, logCommand } from "./commands/log.ts";
import { executeReset, resetCommand } from "./commands/reset.ts";
import { executeStatus, statusCommand } from "./commands/status.ts";
import { exitWithError } from "./utils/output.ts";
import pkgJson from "../package.json" with { type: "json" };

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
export const parser = or(
  addCommand,
  commitCommand,
  diffCommand,
  logCommand,
  resetCommand,
  statusCommand,
);

/**
 * The gitique CLI program with bundled metadata.
 * Demonstrates Optique's Program interface for defining a CLI application
 * with all its metadata in one place.
 */
export const program = defineProgram({
  parser,
  metadata: {
    name: "gitique",
    version: pkgJson.version,
    brief: message`A Git-like CLI built with Optique.`,
    description:
      message`A realistic Git CLI implementation showcasing Optique's type-safe combinatorial parsing and es-git's modern Git operations.`,
    author: message`Hong Minhee ${url("https://hongminhee.org/")}`,
    examples: message`Common commands:

${
      commandLine("gitique add .")
    }                     Stage all changes${lineBreak()}
${
      commandLine('gitique commit -m "message"')
    }       Create a commit${lineBreak()}
${
      commandLine("gitique status")
    }                    Show working tree status${lineBreak()}
${
      commandLine("gitique log --oneline")
    }             View commit history${lineBreak()}
${
      commandLine("gitique diff --cached")
    }             Show staged changes${lineBreak()}

Shell completion:

${
      commandLine("gitique completion bash > ~/.bashrc.d/gitique.bash")
    }${lineBreak()}
${commandLine("gitique completion zsh > ~/.zsh/completions/_gitique")}`,
    footer: message`For more information, visit ${
      url("https://github.com/dahlia/optique")
    }.`,
  },
});

/**
 * Execute the gitique CLI with comprehensive error handling and help support.
 * Uses @optique/run for automatic process integration including:
 * - Argument parsing from process.argv
 * - Terminal color detection
 * - Help command generation
 * - Process exit handling
 * - Shell completion script generation
 */
export async function main(args = process.argv.slice(2)) {
  try {
    const result = run(program, {
      args,
      help: {
        command: { group: "Meta commands" },
        option: { group: "Meta commands" },
      },
      version: {
        value: pkgJson.version,
        command: { group: "Meta commands" },
        option: { group: "Meta commands" },
      },
      completion: {
        command: { group: "Meta commands" },
        option: { group: "Meta commands" },
      },
      aboveError: "usage", // Show usage information above error messages
      showDefault: true, // Display default values in help text
      showChoices: true, // Display possible choices in help text
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
        exitWithError(new Error("Unknown command."));
      }
    }
  } catch (error) {
    exitWithError(error);
  }
}

// Run main() when executed directly.
const isMain: boolean = "main" in import.meta
  ? import.meta.main
  : process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
