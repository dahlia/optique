import { group, merge, object } from "@optique/core/constructs";
import { map, multiple, optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";
import {
  commandLine,
  lineBreak,
  message,
  optionName,
  text,
  valueSet,
} from "@optique/core/message";
import process from "node:process";
import { path, print, printError } from "@optique/run";
import {
  checkoutHead,
  getRepository,
  moveHead,
  resetIndex,
  resolveCommitOid,
  unstageFile,
} from "../utils/git.ts";
import type { Repository } from "es-git";
import { exitWithError } from "../utils/output.ts";

/**
 * Reset mode choices.
 * Demonstrates Optique's choice() value parser.
 */
const resetModes = ["soft", "mixed", "hard"] as const;

function resetModeChoices(values: readonly string[]) {
  return valueSet(values, {
    fallback: "",
    locale: "en-US",
    type: "disjunction",
  });
}

/**
 * Mode options for the reset command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const modeOptions = group(
  "Reset Mode",
  object({
    mode: optional(
      option(
        "--mode",
        choice(resetModes, {
          metavar: "MODE",
          errors: {
            invalidChoice: (input, choices) =>
              message`Unknown reset mode ${input}. Choose ${
                resetModeChoices(choices)
              }.`,
          },
        }),
        {
          description: message`Reset mode: ${
            text("soft")
          } keeps changes staged, ${text("mixed")} unstages changes, ${
            text("hard")
          } discards all changes`,
        },
      ),
    ),
    soft: option("--soft", {
      description: message`Shorthand for ${commandLine("--mode=soft")}`,
    }),
    hard: option("--hard", {
      description: message`Shorthand for ${
        commandLine("--mode=hard")
      } (DANGEROUS: discards all changes)`,
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
 * - optional() for optional values
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
      // Use an explicit --file option instead of a positional argument to
      // avoid ambiguity between commit refs and file paths, which Optique
      // cannot disambiguate via "--" for positional parsers.
      files: multiple(
        option("-f", "--file", path({ metavar: "FILE" }), {
          description: message`Unstage specific files (can be repeated)`,
        }),
      ),
    }),
  ),
  (result) => {
    if ((result.soft || result.hard) && result.mode !== undefined) {
      throw new Error(
        "Cannot use --soft or --hard together with --mode.",
      );
    }
    return {
      ...result,
      mode: result.soft
        ? ("soft" as const)
        : result.hard
        ? ("hard" as const)
        : (result.mode ?? ("mixed" as const)),
    };
  },
);

/**
 * The complete `gitique reset` command parser with documentation.
 */
export const resetCommand = command("reset", resetOptionsParser, {
  brief: message`Reset current HEAD`,
  description: message`Reset current HEAD to the specified state. Use ${
    optionName("--soft")
  } to keep changes staged, omit a mode flag (or use ${
    optionName("--mode=mixed")
  }) for the default mixed reset, or ${
    optionName("--hard")
  } to discard all changes (dangerous).`,
  footer: message`Examples:${lineBreak()}
  ${
    commandLine("gitique reset")
  }                    Mixed reset to HEAD${lineBreak()}
  ${
    commandLine("gitique reset --soft HEAD~1")
  }      Soft reset, keep changes staged${lineBreak()}
  ${
    commandLine("gitique reset --hard")
  }             Hard reset (DANGER: loses changes)${lineBreak()}
  ${commandLine("gitique reset --file file.ts")}      Unstage a specific file`,
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
  repo: Repository,
  files: readonly string[],
  quiet: boolean,
): boolean {
  if (!quiet) {
    print(message`Unstaging ${String(files.length)} file(s).`);
  }

  let hadError = false;
  for (const file of files) {
    try {
      unstageFile(repo, file);
      if (!quiet) {
        print(message`Unstaged ${file}.`);
      }
    } catch (error) {
      hadError = true;
      printError(
        message`Failed to reset ${file}: ${
          text(
            error instanceof Error ? error.message : String(error),
          )
        }`,
      );
    }
  }

  if (hadError) {
    process.exitCode = 1;
    return false;
  }
  return true;
}

/**
 * Resets the repository to a specific commit with the given mode.
 */
function resetToCommit(
  repo: Repository,
  commit: string,
  mode: "soft" | "mixed" | "hard",
  quiet: boolean,
): void {
  if (!quiet) {
    print(message`Performing ${text(mode)} reset to ${commit}.`);
  }

  try {
    // Resolve the spec and move HEAD (and the branch pointer) to the target
    const targetOid = resolveCommitOid(repo, commit);
    moveHead(repo, targetOid);

    switch (mode) {
      case "soft":
        // HEAD moved; index and working directory unchanged
        if (!quiet) {
          print(
            message`Soft reset: HEAD moved, index and working directory unchanged.`,
            { stream: "stderr" },
          );
        }
        break;

      case "mixed":
        // HEAD moved; reset index, keep working directory
        resetIndex(repo);
        if (!quiet) {
          print(
            message`Mixed reset: HEAD and index reset, working directory unchanged.`,
          );
        }
        break;

      case "hard":
        // HEAD moved; reset both index and working directory
        resetIndex(repo);
        checkoutHead(repo, { force: true });
        if (!quiet) {
          print(
            message`Hard reset: HEAD, index, and working directory reset.`,
            { stream: "stderr" },
          );
          print(
            message`All uncommitted changes have been lost.`,
            { stream: "stderr" },
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
      // Reset specific files; bail out without the success banner on failure
      if (!resetFiles(repo, config.files, config.quiet)) return;
    } else {
      // Reset to commit
      const targetCommit = config.commit ?? "HEAD";

      if (config.mode === "hard" && !config.quiet) {
        print(
          message`Warning: Hard reset will permanently delete all uncommitted changes.`,
          { stream: "stderr" },
        );
      }

      resetToCommit(repo, targetCommit, config.mode, config.quiet);
    }

    if (!config.quiet) {
      print(message`Reset operation completed successfully.`);
    }
  } catch (error) {
    exitWithError(error);
  }
}
