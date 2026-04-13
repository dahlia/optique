import { group, merge, object } from "@optique/core/constructs";
import { map, multiple, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import {
  commandLine,
  lineBreak,
  message,
  metavar,
  optionName,
} from "@optique/core/message";
import { printError } from "@optique/run";
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
const algorithms = ["default", "minimal", "patience"] as const;

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
        description: message`Generate diffs with ${
          metavar("LINES")
        } lines of context`,
      }),
      3,
    ),
    algorithm: withDefault(
      option("--diff-algorithm", choice(algorithms, { metavar: "ALGORITHM" }), {
        description:
          message`Choose a diff algorithm (default, minimal, patience)`,
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
      description: message`Synonym for ${optionName("--cached")}`,
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
    // Path filtering via positional arguments is not supported because
    // Optique cannot disambiguate commit refs from file paths without a
    // "--" separator.  All positionals are consumed as commit arguments.
    object({
      commits: multiple(
        argument(string({ metavar: "COMMIT" }), {
          description: message`Commits to compare (0, 1, or 2)`,
        }),
        { max: 2 },
      ),
    }),
  ),
  (result) => {
    // Treat --staged as alias for --cached
    const displayModes = [
      result.stat,
      result.numstat,
      result.nameOnly,
      result.nameStatus,
    ].filter(Boolean).length;
    if (displayModes > 1) {
      throw new Error(
        "Only one of --stat, --numstat, --name-only, --name-status may be used at a time.",
      );
    }
    return { ...result, cached: result.cached || result.staged };
  },
);

/**
 * The complete `gitique diff` command parser with documentation.
 */
export const diffCommand = command("diff", diffOptionsParser, {
  brief: message`Show changes between commits`,
  description:
    message`Show changes between commits, commit and working tree, etc. Use ${
      optionName("--cached")
    } to view staged changes.`,
  footer: message`Examples:${lineBreak()}
  ${
    commandLine("gitique diff")
  }                    Show unstaged changes${lineBreak()}
  ${
    commandLine("gitique diff --cached")
  }           Show staged changes${lineBreak()}
  ${
    commandLine("gitique diff HEAD~1")
  }             Compare with previous commit${lineBreak()}
  ${
    commandLine("gitique diff --stat")
  }             Show change statistics${lineBreak()}
  ${
    commandLine("gitique diff --name-only")
  }        Show only changed file names`,
});

/**
 * Type inference for the diff command configuration.
 */
export type DiffConfig = InferValue<typeof diffCommand>;

/**
 * Parses per-file insertion/deletion counts from unified diff text.
 * Uses a state machine to distinguish file-header lines from hunk content,
 * so that content lines whose text starts with '+' or '-' are never
 * mistaken for file headers.
 */
function parseNumstat(
  diffText: string,
): Map<string, { ins: number; del: number }> {
  const result = new Map<string, { ins: number; del: number }>();
  let currentPath: string | null = null;
  let pendingOldPath: string | null = null;
  let inHunk = false;
  let ins = 0;
  let del = 0;

  const flush = () => {
    if (currentPath !== null) {
      result.set(currentPath, { ins, del });
      currentPath = null;
      ins = 0;
      del = 0;
    }
  };

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      // Start of a new file patch — flush previous file and reset hunk state.
      flush();
      inHunk = false;
      pendingOldPath = null;
    } else if (line.startsWith("@@")) {
      // Hunk header — from here on, +/- lines are content, not file headers.
      inHunk = true;
    } else if (!inHunk && line.startsWith("--- a/")) {
      pendingOldPath = line.slice(6);
    } else if (!inHunk && line.startsWith("--- /dev/null")) {
      pendingOldPath = null; // New file — path comes from the +++ line
    } else if (!inHunk && line.startsWith("+++ b/")) {
      currentPath = line.slice(6);
      pendingOldPath = null;
    } else if (!inHunk && line.startsWith("+++ /dev/null")) {
      // Deletion — use the old path captured from --- line
      currentPath = pendingOldPath;
      pendingOldPath = null;
    } else if (inHunk && line.startsWith("+")) {
      if (currentPath !== null) ins++;
    } else if (inHunk && line.startsWith("-")) {
      if (currentPath !== null) del++;
    }
  }
  flush();

  return result;
}

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
    const commit2 = config.commits.length > 1 ? config.commits[1] : undefined;

    const diffResult = getDiff(repo, {
      cached: config.cached,
      commit,
      commit2,
      unified: config.unified,
      algorithm: config.algorithm,
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
        // Print stat-style summary for each file.
        // Per-file insertion/deletion counts are not available from es-git,
        // so only file names are shown; totals are approximate.
        for (const delta of diffResult.deltas) {
          console.log(` ${delta.path}`);
        }
        console.log("");
        console.log(
          "(approximate) " + formatDiffStats(
            diffResult.stats.filesChanged,
            diffResult.stats.insertions,
            diffResult.stats.deletions,
          ),
        );
        break;
      }

      case "numstat": {
        // Parse per-file counts from the diff text.
        const fileStats = parseNumstat(diffResult.text);
        for (const delta of diffResult.deltas) {
          const stats = fileStats.get(delta.path) ?? { ins: 0, del: 0 };
          console.log(`${stats.ins}\t${stats.del}\t${delta.path}`);
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
