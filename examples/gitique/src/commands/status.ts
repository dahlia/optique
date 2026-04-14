import { group, merge, object } from "@optique/core/constructs";
import { map, optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import {
  commandLine,
  lineBreak,
  message,
  optionName,
  valueSet,
} from "@optique/core/message";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepository, getStatus } from "../utils/git.ts";
import type { FileStatus } from "../utils/git.ts";
import { colors, formatStatusLong } from "../utils/formatters.ts";
import { exitWithError } from "../utils/output.ts";

type FileStatusEntry = Pick<FileStatus, "path" | "status" | "oldPath">;

/**
 * Reads the current branch name from the repository even when HEAD hasn't been
 * resolved yet (i.e., an unborn branch where the branch ref doesn't exist).
 * Returns the branch name string, or null if HEAD is detached or unreadable.
 */
function readHeadBranchName(gitDir: string): string | null {
  try {
    const headContent = readFileSync(resolve(gitDir, "HEAD"), "utf-8").trim();
    if (headContent.startsWith("ref: refs/heads/")) {
      return headContent.slice("ref: refs/heads/".length);
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

const statusIndicatorMap: Record<FileStatus["status"], string> = {
  Added: "A",
  Deleted: "D",
  Modified: "M",
  Renamed: "R",
  Copied: "C",
  Untracked: "?",
  Typechange: "T",
  Conflicted: "U",
};

/**
 * Merges staged and unstaged state into a single short-format status line,
 * producing the XY two-column format used by `git status -s`.
 */
function formatStatusShortMerged(
  stagedEntry: FileStatusEntry | undefined,
  unstagedEntry: FileStatusEntry | undefined,
  path: string,
): string {
  // Untracked files use '??' in both columns (git status -s convention).
  const isUntracked = !stagedEntry && unstagedEntry?.status === "Untracked";
  const stagedCol = isUntracked
    ? "?"
    : (stagedEntry ? (statusIndicatorMap[stagedEntry.status] ?? "?") : " ");
  const unstagedCol = unstagedEntry
    ? (statusIndicatorMap[unstagedEntry.status] ?? "?")
    : " ";
  const oldPath = stagedEntry?.oldPath ?? unstagedEntry?.oldPath;
  const displayPath = oldPath ? `${oldPath} -> ${path}` : path;
  const stagedColor = isUntracked
    ? colors.red
    : (stagedEntry ? colors.green : "");
  const unstagedColor = unstagedEntry ? colors.red : "";
  return `${stagedColor}${stagedCol}${colors.reset}${unstagedColor}${unstagedCol}${colors.reset} ${displayPath}`;
}

/**
 * Merges staged and unstaged state into a single porcelain-format status line.
 */
function formatStatusPorcelainMerged(
  stagedEntry: FileStatusEntry | undefined,
  unstagedEntry: FileStatusEntry | undefined,
  path: string,
): string {
  // Untracked files use '??' in both columns (git status --porcelain convention).
  const isUntracked = !stagedEntry && unstagedEntry?.status === "Untracked";
  const stagedCol = isUntracked
    ? "?"
    : (stagedEntry ? (statusIndicatorMap[stagedEntry.status] ?? "?") : " ");
  const unstagedCol = unstagedEntry
    ? (statusIndicatorMap[unstagedEntry.status] ?? "?")
    : " ";
  const oldPath = stagedEntry?.oldPath ?? unstagedEntry?.oldPath;
  if (oldPath) {
    return `${stagedCol}${unstagedCol} ${oldPath} -> ${path}`;
  }
  return `${stagedCol}${unstagedCol} ${path}`;
}

/**
 * Output format choices for the status command.
 * Demonstrates Optique's choice() value parser.
 */
const outputFormats = ["long", "short", "porcelain"] as const;

function outputFormatChoices(values: readonly string[]) {
  return valueSet(values, {
    fallback: "",
    locale: "en-US",
    type: "disjunction",
  });
}

/**
 * Display options for the status command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const displayOptions = group(
  "Display Options",
  object({
    format: optional(
      option(
        "--format",
        choice(outputFormats, {
          metavar: "FORMAT",
          errors: {
            invalidChoice: (input, choices) =>
              message`Unknown status format ${input}. Choose ${
                outputFormatChoices(choices)
              }.`,
          },
        }),
        {
          description: message`Output format`,
        },
      ),
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
  (result) => {
    if ((result.short || result.porcelain) && result.format !== undefined) {
      throw new Error(
        "Cannot use --short or --porcelain together with --format.",
      );
    }
    if (result.short && result.porcelain) {
      throw new Error("Cannot use --short and --porcelain together.");
    }
    return {
      ...result,
      format: result.short
        ? ("short" as const)
        : result.porcelain
        ? ("porcelain" as const)
        : (result.format ?? ("long" as const)),
    };
  },
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
  footer: message`Examples:${lineBreak()}
  ${commandLine("gitique status")}              Show full status${lineBreak()}
  ${commandLine("gitique status -s")}           Show short format${lineBreak()}
  ${
    commandLine("gitique status --porcelain")
  }  Machine-readable format${lineBreak()}
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

    // Determine branch state once for use in both -b header and long body.
    let resolvedBranchName: string | null = null;
    let isUnbornBranch = false;
    if (!repo.headDetached()) {
      try {
        resolvedBranchName = repo.head().name().replace("refs/heads/", "");
      } catch {
        // HEAD can't be resolved (unborn branch) — read from .git/HEAD
        resolvedBranchName = readHeadBranchName(repo.path());
        isUnbornBranch = true;
      }
    }

    // Show branch information: always in long format, only with -b in
    // short/porcelain formats (where it changes the output structure).
    if (config.branch || config.format === "long") {
      if (config.format === "porcelain" || config.format === "short") {
        // Machine-readable / short format: ## <branch> header line.
        // git uses "## No commits yet on <branch>" for unborn branches.
        if (repo.headDetached()) {
          console.log("## HEAD (no branch)");
        } else if (isUnbornBranch && resolvedBranchName) {
          console.log(`## No commits yet on ${resolvedBranchName}`);
        } else if (resolvedBranchName) {
          console.log(`## ${resolvedBranchName}`);
        } else {
          console.log("## HEAD (no branch)");
        }
      } else {
        // Long format: human-readable branch header.
        if (repo.headDetached()) {
          console.log("Not currently on any branch.");
          console.log("");
        } else if (resolvedBranchName) {
          console.log(
            `On branch ${colors.green}${resolvedBranchName}${colors.reset}`,
          );
          if (isUnbornBranch) {
            console.log("");
            console.log("No commits yet");
          }
          console.log("");
        } else {
          console.log("Not currently on any branch.");
          console.log("");
        }
      }
    }

    if (statuses.length === 0) {
      if (config.format === "long") {
        if (isUnbornBranch) {
          console.log(
            "nothing to commit (create/copy files and use 'gitique add' to track)",
          );
        } else {
          console.log("nothing to commit, working tree clean");
        }
      }
      return;
    }

    // Separate staged and unstaged changes
    const staged = statuses.filter((s) => s.staged);
    const unstaged = statuses.filter((s) => !s.staged);

    // Pre-index staged/unstaged entries for O(1) lookups in the merge loops.
    const stagedByPath = new Map(staged.map((entry) => [entry.path, entry]));
    const unstagedByPath = new Map(
      unstaged.map((entry) => [entry.path, entry]),
    );

    // Format output based on format option
    switch (config.format) {
      case "long": {
        if (staged.length > 0) {
          console.log("Changes to be committed:");
          console.log('  (use "gitique reset --file <file>..." to unstage)');
          console.log("");
          for (const file of staged) {
            console.log(
              formatStatusLong(file.path, file.status, true, file.oldPath),
            );
          }
          console.log("");
        }

        const tracked = unstaged.filter((f) => f.status !== "Untracked");
        const untracked = unstaged.filter((f) => f.status === "Untracked");

        if (tracked.length > 0) {
          console.log("Changes not staged for commit:");
          console.log(
            '  (use "gitique add <file>..." to update what will be committed)',
          );
          console.log("");
          for (const file of tracked) {
            console.log(
              formatStatusLong(file.path, file.status, false, file.oldPath),
            );
          }
          console.log("");
        }

        if (untracked.length > 0) {
          console.log("Untracked files:");
          console.log(
            '  (use "gitique add <file>..." to include in what will be committed)',
          );
          console.log("");
          for (const file of untracked) {
            console.log(
              formatStatusLong(file.path, file.status, false, file.oldPath),
            );
          }
        }
        break;
      }

      case "short": {
        // Merge staged and unstaged entries for the same path into one line
        // so a dual-state file shows "MM" instead of two separate lines.
        // Exception: a staged deletion + new untracked file at the same path
        // must stay as two separate lines ("D  foo" + "?? foo"), matching git.
        const seenShort = new Set<string>();
        for (const file of statuses) {
          if (seenShort.has(file.path)) continue;
          seenShort.add(file.path);
          const stagedEntry = stagedByPath.get(file.path);
          const unstagedEntry = unstagedByPath.get(file.path);
          if (
            stagedEntry?.status === "Deleted" &&
            unstagedEntry?.status === "Untracked"
          ) {
            // Emit two separate lines rather than a merged "D?" line
            console.log(
              formatStatusShortMerged(stagedEntry, undefined, file.path),
            );
            console.log(
              formatStatusShortMerged(undefined, unstagedEntry, file.path),
            );
          } else {
            console.log(
              formatStatusShortMerged(stagedEntry, unstagedEntry, file.path),
            );
          }
        }
        break;
      }

      case "porcelain": {
        const seenPorcelain = new Set<string>();
        for (const file of statuses) {
          if (seenPorcelain.has(file.path)) continue;
          seenPorcelain.add(file.path);
          const stagedEntry = stagedByPath.get(file.path);
          const unstagedEntry = unstagedByPath.get(file.path);
          if (
            stagedEntry?.status === "Deleted" &&
            unstagedEntry?.status === "Untracked"
          ) {
            // Emit two separate lines rather than a merged "D?" line
            console.log(
              formatStatusPorcelainMerged(stagedEntry, undefined, file.path),
            );
            console.log(
              formatStatusPorcelainMerged(
                undefined,
                unstagedEntry,
                file.path,
              ),
            );
          } else {
            console.log(
              formatStatusPorcelainMerged(
                stagedEntry,
                unstagedEntry,
                file.path,
              ),
            );
          }
        }
        break;
      }
    }
  } catch (error) {
    exitWithError(error);
  }
}
