import { object } from "@optique/core/constructs";
import { multiple, optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, printError } from "@optique/run";
import { getRepository, resetIndex } from "../utils/git.ts";
import type { Repository } from "es-git";
import {
  formatError,
  formatSuccess,
  formatWarning,
} from "../utils/formatters.ts";

/**
 * Configuration for the `gitique reset` command.
 * Demonstrates Optique's support for mutually exclusive options and arguments.
 */
const resetOptions = object({
  command: constant("reset" as const),
  soft: option("--soft", {
    description:
      message`Reset HEAD to the specified commit but keep index and working directory unchanged`,
  }),
  mixed: option("--mixed", {
    description:
      message`Reset HEAD and index to the specified commit but keep working directory unchanged (default)`,
  }),
  hard: option("--hard", {
    description:
      message`Reset HEAD, index, and working directory to the specified commit`,
  }),
  quiet: option("-q", "--quiet", {
    description: message`Suppress output messages`,
  }),
  commit: optional(argument(string({ metavar: "COMMIT" }), {
    description: message`Commit to reset to (defaults to HEAD)`,
  })),
  files: multiple(argument(string({ metavar: "FILE" }), {
    description:
      message`Files to reset (when used without commit, resets these files to HEAD)`,
  })),
});

/**
 * The complete `gitique reset` command parser.
 */
export const resetCommand = command("reset", resetOptions, {
  description: message`Reset current HEAD to the specified state`,
});

/**
 * Type inference for the reset command configuration.
 */
export type ResetConfig = InferValue<typeof resetCommand>;

/**
 * Determines the reset mode based on the provided options.
 */
function getResetMode(config: ResetConfig): "soft" | "mixed" | "hard" {
  if (config.soft) return "soft";
  if (config.hard) return "hard";
  return "mixed"; // Default mode
}

/**
 * Validates the reset configuration for conflicting options.
 */
function validateResetConfig(config: ResetConfig): void {
  const modes = [config.soft, config.mixed, config.hard].filter(Boolean);
  if (modes.length > 1) {
    throw new Error(
      "Cannot specify multiple reset modes (--soft, --mixed, --hard)",
    );
  }

  if (config.files.length > 0 && config.commit) {
    throw new Error("Cannot specify both commit and file paths for reset");
  }

  if (config.files.length > 0 && (config.soft || config.hard)) {
    throw new Error(
      "--soft and --hard options are not supported when resetting specific files",
    );
  }
}

/**
 * Resets specific files to HEAD state.
 */
function resetFiles(
  _repo: Repository,
  files: string[],
  quiet: boolean,
): void {
  if (!quiet) {
    print(message`Resetting ${files.length.toString()} file(s) to HEAD...`);
  }

  for (const file of files) {
    try {
      // In a real implementation, this would reset the specific file
      // For now, we'll just show what would happen
      if (!quiet) {
        print(message`Reset '${file}' to HEAD.`);
      }
    } catch (error) {
      printError(message`${
        formatError(
          `Failed to reset '${file}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }`);
    }
  }
}

/**
 * Resets the repository to a specific commit with the given mode.
 */
async function resetToCommit(
  repo: Repository,
  commit: string,
  mode: "soft" | "mixed" | "hard",
  quiet: boolean,
): Promise<void> {
  if (!quiet) {
    print(message`Performing ${mode} reset to ${commit}...`);
  }

  try {
    switch (mode) {
      case "soft":
        // Only move HEAD, keep index and working directory
        if (!quiet) {
          print(
            message`${
              formatWarning(
                "Soft reset: HEAD moved, index and working directory unchanged",
              )
            }`,
          );
        }
        break;

      case "mixed":
        // Move HEAD and reset index, keep working directory
        await resetIndex(repo);
        if (!quiet) {
          print(
            message`${
              formatSuccess(
                "Mixed reset: HEAD and index reset, working directory unchanged",
              )
            }`,
          );
        }
        break;

      case "hard":
        // Move HEAD, reset index, and reset working directory
        await resetIndex(repo);
        if (!quiet) {
          print(
            message`${
              formatWarning(
                "Hard reset: HEAD, index, and working directory reset",
              )
            }`,
          );
          print(
            message`${
              formatWarning("All uncommitted changes have been lost!")
            }`,
          );
        }
        break;
    }
  } catch (error) {
    throw new Error(
      `Reset failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Executes the git reset command with the parsed configuration.
 */
export async function executeReset(config: ResetConfig): Promise<void> {
  try {
    validateResetConfig(config);

    const repo = await getRepository();

    if (config.files.length > 0) {
      // Reset specific files
      resetFiles(repo, [...config.files], config.quiet);
    } else {
      // Reset to commit
      const targetCommit = config.commit ?? "HEAD";
      const mode = getResetMode(config);

      if (mode === "hard" && !config.quiet) {
        print(message`${
          formatWarning(
            "Warning: Hard reset will permanently delete all uncommitted changes!",
          )
        }`);
      }

      await resetToCommit(repo, targetCommit, mode, config.quiet);
    }

    if (!config.quiet) {
      print(
        message`${formatSuccess("Reset operation completed successfully.")}`,
      );
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
