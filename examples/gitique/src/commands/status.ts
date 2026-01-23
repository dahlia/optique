import { group, merge, object } from "@optique/core/constructs";
import { map, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { commandLine, message, optionName } from "@optique/core/message";
import { printError } from "@optique/run";
import { getRepository, getStatus } from "../utils/git.ts";
import {
  colors,
  formatError,
  formatStatusLong,
  formatStatusPorcelain,
  formatStatusShort,
} from "../utils/formatters.ts";

/**
 * Output format choices for the status command.
 * Demonstrates Optique's choice() value parser.
 */
const outputFormats = ["long", "short", "porcelain"] as const;

/**
 * Display options for the status command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const displayOptions = group(
  "Display Options",
  object({
    format: withDefault(
      option("--format", choice(outputFormats, { metavar: "FORMAT" }), {
        description:
          message`Output format: long (default), short, or porcelain`,
      }),
      "long" as const,
    ),
    short: option("-s", "--short", {
      description: message`Shorthand for ${optionName("--format")}=short`,
    }),
    porcelain: option("--porcelain", {
      description: message`Shorthand for ${
        optionName("--format")
      }=porcelain (machine-readable)`,
    }),
    branch: option("-b", "--branch", {
      description: message`Show branch information`,
    }),
  }),
);

/**
 * The complete status command parser.
 * Demonstrates:
 * - group() for organizing options in help text
 * - merge() for combining multiple option groups
 * - withDefault() for default values
 * - choice() for enumerated values
 * - map() for transforming parser results
 */
const statusOptionsParser = map(
  merge(
    object({ command: constant("status" as const) }),
    displayOptions,
  ),
  (result) => ({
    ...result,
    // Handle shorthand flags by overriding format
    format: result.short
      ? ("short" as const)
      : result.porcelain
      ? ("porcelain" as const)
      : result.format,
  }),
);

/**
 * The complete `gitique status` command parser with documentation.
 */
export const statusCommand = command("status", statusOptionsParser, {
  brief: message`Show working tree status`,
  description:
    message`Display the state of the working directory and staging area. Use ${
      optionName("-s")
    } for compact output or ${
      optionName("--porcelain")
    } for machine-readable format.`,
  footer: message`Examples:
  ${commandLine("gitique status")}              Show full status
  ${commandLine("gitique status -s")}           Show short format
  ${commandLine("gitique status --porcelain")}  Machine-readable format
  ${commandLine("gitique status -b")}           Show branch information`,
});

/**
 * Type inference for the status command configuration.
 */
export type StatusConfig = InferValue<typeof statusCommand>;

/**
 * Executes the git status command with the parsed configuration.
 */
export async function executeStatus(config: StatusConfig): Promise<void> {
  try {
    const repo = await getRepository();
    const statuses = getStatus(repo);

    // Show branch information if requested
    if (config.branch) {
      try {
        const head = repo.head();
        const branchName = head.name().replace("refs/heads/", "");
        console.log(`On branch ${colors.green}${branchName}${colors.reset}`);
        console.log("");
      } catch {
        console.log("Not currently on any branch.");
        console.log("");
      }
    }

    if (statuses.length === 0) {
      if (config.format === "long") {
        console.log("nothing to commit, working tree clean");
      }
      return;
    }

    // Separate staged and unstaged changes
    const staged = statuses.filter((s) => s.staged);
    const unstaged = statuses.filter((s) => !s.staged);

    // Format output based on format option
    switch (config.format) {
      case "long": {
        if (staged.length > 0) {
          console.log("Changes to be committed:");
          console.log('  (use "gitique reset HEAD <file>..." to unstage)');
          console.log("");
          for (const file of staged) {
            console.log(
              formatStatusLong(file.path, file.status, true, file.oldPath),
            );
          }
          console.log("");
        }

        if (unstaged.length > 0) {
          console.log("Changes not staged for commit:");
          console.log(
            '  (use "gitique add <file>..." to update what will be committed)',
          );
          console.log("");
          for (const file of unstaged) {
            console.log(
              formatStatusLong(file.path, file.status, false, file.oldPath),
            );
          }
        }
        break;
      }

      case "short": {
        for (const file of statuses) {
          console.log(
            formatStatusShort(
              file.path,
              file.status,
              file.staged,
              file.oldPath,
            ),
          );
        }
        break;
      }

      case "porcelain": {
        for (const file of statuses) {
          console.log(
            formatStatusPorcelain(
              file.path,
              file.status,
              file.staged,
              file.oldPath,
            ),
          );
        }
        break;
      }
    }
  } catch (error) {
    printError(
      message`${
        formatError(error instanceof Error ? error.message : String(error))
      }`,
      { exitCode: 1 },
    );
  }
}
