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
} from "@optique/core/message";
import { printError } from "@optique/run";
import { getRepository, getStatus } from "../utils/git.ts";
import type { FileStatus } from "../utils/git.ts";
import { colors, formatError, formatStatusLong } from "../utils/formatters.ts";

type FileStatusEntry = Pick<FileStatus, "path" | "status" | "oldPath">;

const statusIndicatorMap: Record<string, string> = {
  Added: "A",
  Deleted: "D",
  Modified: "M",
  Renamed: "R",
  Copied: "C",
  Untracked: "?",
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
  const stagedCol = stagedEntry
    ? (statusIndicatorMap[stagedEntry.status] ?? "?")
    : " ";
  const unstagedCol = unstagedEntry
    ? (statusIndicatorMap[unstagedEntry.status] ?? "?")
    : " ";
  const oldPath = stagedEntry?.oldPath ?? unstagedEntry?.oldPath;
  const displayPath = oldPath ? `${oldPath} -> ${path}` : path;
  const stagedColor = stagedEntry ? colors.green : "";
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
  const stagedCol = stagedEntry
    ? (statusIndicatorMap[stagedEntry.status] ?? "?")
    : " ";
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

/**
 * Display options for the status command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const displayOptions = group(
  "Display Options",
  object({
    format: optional(
      option("--format", choice(outputFormats, { metavar: "FORMAT" }), {
        description:
          message`Output format: long (default), short, or porcelain`,
      }),
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

    // Show branch information if requested
    if (config.branch) {
      if (config.format === "porcelain") {
        // Machine-readable porcelain v1 branch line
        try {
          const head = repo.head();
          const branchName = head.name().replace("refs/heads/", "");
          console.log(`## ${branchName}`);
        } catch {
          console.log("## HEAD (no branch)");
        }
      } else {
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
        // Merge staged and unstaged entries for the same path into one line
        // so a dual-state file shows "MM" instead of two separate lines.
        const seenShort = new Set<string>();
        for (const file of statuses) {
          if (seenShort.has(file.path)) continue;
          seenShort.add(file.path);
          const stagedEntry = staged.find((s) => s.path === file.path);
          const unstagedEntry = unstaged.find((u) => u.path === file.path);
          console.log(
            formatStatusShortMerged(stagedEntry, unstagedEntry, file.path),
          );
        }
        break;
      }

      case "porcelain": {
        const seenPorcelain = new Set<string>();
        for (const file of statuses) {
          if (seenPorcelain.has(file.path)) continue;
          seenPorcelain.add(file.path);
          const stagedEntry = staged.find((s) => s.path === file.path);
          const unstagedEntry = unstaged.find((u) => u.path === file.path);
          console.log(
            formatStatusPorcelainMerged(stagedEntry, unstagedEntry, file.path),
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
