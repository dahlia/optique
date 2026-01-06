import { group, merge, object } from "@optique/core/constructs";
import { map, multiple, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { path, printError } from "@optique/run";
import process from "node:process";
import { getDiff, getRepository } from "../utils/git.ts";
import {
  formatDiffNameOnly,
  formatDiffNameStatus,
  formatDiffStats,
  formatError,
} from "../utils/formatters.ts";

/**
 * Diff algorithm choices.
 * Demonstrates Optique's choice() value parser.
 */
const algorithms = ["default", "minimal", "patience", "histogram"] as const;

/**
 * Display options for the diff command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const displayOptions = group(
  "Display Options",
  object({
    stat: option("--stat", {
      description: message`Show diffstat instead of patch`,
    }),
    numstat: option("--numstat", {
      description:
        message`Show number of added/deleted lines in decimal notation`,
    }),
    nameOnly: option("--name-only", {
      description: message`Show only names of changed files`,
    }),
    nameStatus: option("--name-status", {
      description: message`Show names and status of changed files`,
    }),
  }),
);

/**
 * Context options for the diff command.
 * Demonstrates withDefault() for providing default values.
 */
const contextOptions = group(
  "Context Options",
  object({
    unified: withDefault(
      option("-U", "--unified", integer({ metavar: "LINES", min: 0 }), {
        description: message`Generate diffs with <n> lines of context`,
      }),
      3,
    ),
    algorithm: withDefault(
      option("--diff-algorithm", choice(algorithms, { metavar: "ALGORITHM" }), {
        description: message`Choose a diff algorithm`,
      }),
      "default" as const,
    ),
  }),
);

/**
 * Filter options for the diff command.
 */
const filterOptions = group(
  "Filter Options",
  object({
    cached: option("--cached", {
      description: message`View staged changes`,
    }),
    staged: option("--staged", {
      description: message`Synonym for --cached`,
    }),
  }),
);

/**
 * The complete diff command parser.
 * Demonstrates:
 * - group() for organizing options in help text
 * - merge() for combining multiple option groups
 * - withDefault() for default values
 * - choice() for enumerated values
 * - multiple() with max constraint for limiting arguments
 * - map() for transforming parser results
 */
const diffOptionsParser = map(
  merge(
    object({ command: constant("diff" as const) }),
    displayOptions,
    contextOptions,
    filterOptions,
    object({
      commits: multiple(
        argument(string({ metavar: "COMMIT" }), {
          description: message`Commits to compare (0, 1, or 2)`,
        }),
        { max: 2 },
      ),
      paths: multiple(
        argument(path({ metavar: "PATH" }), {
          description: message`Limit diff to these paths`,
        }),
      ),
    }),
  ),
  (result) => ({
    ...result,
    // Treat --staged as alias for --cached
    cached: result.cached || result.staged,
  }),
);

/**
 * The complete `gitique diff` command parser with documentation.
 */
export const diffCommand = command("diff", diffOptionsParser, {
  brief: message`Show changes between commits`,
  description:
    message`Show changes between commits, commit and working tree, etc.`,
  footer: message`Examples:
  gitique diff                    Show unstaged changes
  gitique diff --cached           Show staged changes
  gitique diff HEAD~1             Compare with previous commit
  gitique diff --stat             Show change statistics
  gitique diff --name-only        Show only changed file names`,
});

/**
 * Type inference for the diff command configuration.
 */
export type DiffConfig = InferValue<typeof diffCommand>;

/**
 * Determines the output mode based on display options.
 */
type OutputMode = "patch" | "stat" | "numstat" | "name-only" | "name-status";

function getOutputMode(config: DiffConfig): OutputMode {
  if (config.stat) return "stat";
  if (config.numstat) return "numstat";
  if (config.nameOnly) return "name-only";
  if (config.nameStatus) return "name-status";
  return "patch";
}

/**
 * Executes the git diff command with the parsed configuration.
 */
export async function executeDiff(config: DiffConfig): Promise<void> {
  try {
    const repo = await getRepository();

    // Determine what to diff
    const commit = config.commits.length > 0 ? config.commits[0] : undefined;

    const diffResult = getDiff(repo, {
      cached: config.cached,
      commit,
      paths: config.paths.length > 0 ? [...config.paths] : undefined,
    });

    const outputMode = getOutputMode(config);

    if (diffResult.deltas.length === 0) {
      // No changes - output nothing (matching git behavior)
      return;
    }

    switch (outputMode) {
      case "patch": {
        // Print the full diff text (trim trailing newline to avoid double newline)
        process.stdout.write(diffResult.text);
        break;
      }

      case "stat": {
        // Print stat-style summary for each file
        for (const delta of diffResult.deltas) {
          // Note: We don't have per-file stats, so just show file names with status
          console.log(` ${delta.path}`);
        }
        console.log("");
        console.log(
          formatDiffStats(
            diffResult.stats.filesChanged,
            diffResult.stats.insertions,
            diffResult.stats.deletions,
          ),
        );
        break;
      }

      case "numstat": {
        // Print numstat format (insertions deletions filename)
        // Note: We don't have per-file stats, showing totals
        console.log(
          `${diffResult.stats.insertions}\t${diffResult.stats.deletions}\ttotal`,
        );
        for (const delta of diffResult.deltas) {
          console.log(`-\t-\t${delta.path}`);
        }
        break;
      }

      case "name-only": {
        for (const delta of diffResult.deltas) {
          console.log(formatDiffNameOnly(delta.path));
        }
        break;
      }

      case "name-status": {
        for (const delta of diffResult.deltas) {
          console.log(
            formatDiffNameStatus(delta.path, delta.status, delta.oldPath),
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
