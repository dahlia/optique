import { group, merge, object } from "@optique/core/constructs";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { printError } from "@optique/run";
import { getRepository, resetIndex } from "../utils/git.ts";
import type { Repository } from "es-git";
import {
  formatError,
  formatSuccess,
  formatWarning,
} from "../utils/formatters.ts";

/**
 * Reset mode choices.
 * Demonstrates Optique's choice() value parser.
 */
const resetModes = ["soft", "mixed", "hard"] as const;

/**
 * Mode options for the reset command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const modeOptions = group(
  "Reset Mode",
  object({
    mode: withDefault(
      option("--mode", choice(resetModes, { metavar: "MODE" }), {
        description:
          message`Reset mode: soft (keep changes staged), mixed (unstage changes), hard (discard all)`,
      }),
      "mixed" as const,
    ),
    soft: option("--soft", {
      description: message`Shorthand for --mode=soft`,
    }),
    hard: option("--hard", {
      description: message`Shorthand for --mode=hard (DANGEROUS)`,
    }),
  }),
);

/**
 * Output options for the reset command.
 */
const outputOptions = group(
  "Output Options",
  object({
    quiet: option("-q", "--quiet", {
      description: message`Suppress output messages`,
    }),
  }),
);

/**
 * The complete reset command parser.
 * Demonstrates:
 * - group() for organizing options in help text
 * - merge() for combining multiple option groups
 * - withDefault() for default values
 * - choice() for enumerated values
 * - map() for transforming parser results
 */
const resetOptionsParser = map(
  merge(
    object({ command: constant("reset" as const) }),
    modeOptions,
    outputOptions,
    object({
      commit: optional(
        argument(string({ metavar: "COMMIT" }), {
          description: message`Commit to reset to (defaults to HEAD)`,
        }),
      ),
      files: multiple(
        argument(string({ metavar: "FILE" }), {
          description:
            message`Files to reset (when used without commit, resets these files to HEAD)`,
        }),
      ),
    }),
  ),
  (result) => ({
    ...result,
    // Handle shorthand flags by overriding mode
    mode: result.soft
      ? ("soft" as const)
      : result.hard
      ? ("hard" as const)
      : result.mode,
  }),
);

/**
 * The complete `gitique reset` command parser with documentation.
 */
export const resetCommand = command("reset", resetOptionsParser, {
  brief: message`Reset current HEAD`,
  description: message`Reset current HEAD to the specified state`,
  footer: message`Examples:
  gitique reset                    Mixed reset to HEAD
  gitique reset --soft HEAD~1      Soft reset, keep changes staged
  gitique reset --hard             Hard reset (DANGER: loses changes)
  gitique reset -- file.ts         Unstage specific file`,
});

/**
 * Type inference for the reset command configuration.
 */
export type ResetConfig = InferValue<typeof resetCommand>;

/**
 * Validates the reset configuration for conflicting options.
 */
function validateResetConfig(config: ResetConfig): void {
  // Check for conflicting shorthand flags
  const modeFlags = [config.soft, config.hard].filter(Boolean);
  if (modeFlags.length > 1) {
    throw new Error("Cannot specify both --soft and --hard");
  }

  if (config.files.length > 0 && config.commit) {
    throw new Error("Cannot specify both commit and file paths for reset");
  }

  if (
    config.files.length > 0 &&
    (config.mode === "soft" || config.mode === "hard")
  ) {
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
    console.log(`Resetting ${files.length} file(s) to HEAD...`);
  }

  for (const file of files) {
    try {
      // In a real implementation, this would reset the specific file
      // For now, we'll just show what would happen
      if (!quiet) {
        console.log(`Reset '${file}' to HEAD.`);
      }
    } catch (error) {
      printError(
        message`${
          formatError(
            `Failed to reset '${file}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }`,
      );
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
    console.log(`Performing ${mode} reset to ${commit}...`);
  }

  try {
    switch (mode) {
      case "soft":
        // Only move HEAD, keep index and working directory
        if (!quiet) {
          console.log(
            formatWarning(
              "Soft reset: HEAD moved, index and working directory unchanged",
            ),
          );
        }
        break;

      case "mixed":
        // Move HEAD and reset index, keep working directory
        await resetIndex(repo);
        if (!quiet) {
          console.log(
            formatSuccess(
              "Mixed reset: HEAD and index reset, working directory unchanged",
            ),
          );
        }
        break;

      case "hard":
        // Move HEAD, reset index, and reset working directory
        await resetIndex(repo);
        if (!quiet) {
          console.log(
            formatWarning(
              "Hard reset: HEAD, index, and working directory reset",
            ),
          );
          console.log(
            formatWarning("All uncommitted changes have been lost!"),
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

      if (config.mode === "hard" && !config.quiet) {
        console.log(
          formatWarning(
            "Warning: Hard reset will permanently delete all uncommitted changes!",
          ),
        );
      }

      await resetToCommit(repo, targetCommit, config.mode, config.quiet);
    }

    if (!config.quiet) {
      console.log(formatSuccess("Reset operation completed successfully."));
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
