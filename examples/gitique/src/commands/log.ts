import { group, merge, object } from "@optique/core/constructs";
import { map, optional, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { commandLine, message, optionName } from "@optique/core/message";
import { printError } from "@optique/run";
import { getCommitHistory, getRepository } from "../utils/git.ts";
import {
  formatCommitDetailed,
  formatCommitOneline,
  formatError,
} from "../utils/formatters.ts";
import type { Commit } from "es-git";

/**
 * Output format choices for the log command.
 * Demonstrates Optique's choice() value parser.
 */
const formatChoices = ["oneline", "short", "medium", "full"] as const;

/**
 * Display options for the log command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const displayOptions = group(
  "Display Options",
  object({
    format: withDefault(
      option("--format", choice(formatChoices, { metavar: "FORMAT" }), {
        description: message`Output format: oneline, short, medium, or full`,
      }),
      "medium" as const,
    ),
    oneline: option("--oneline", {
      description: message`Shorthand for ${optionName("--format")}=oneline`,
    }),
    maxCount: withDefault(
      option("-n", "--max-count", integer({ metavar: "NUMBER", min: 1 }), {
        description: message`Limit the number of commits to show`,
      }),
      10,
    ),
  }),
);

/**
 * Filter options for the log command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const filterOptions = group(
  "Filter Options",
  object({
    since: optional(
      option("--since", string({ metavar: "DATE" }), {
        description: message`Show commits after the specified date`,
      }),
    ),
    until: optional(
      option("--until", string({ metavar: "DATE" }), {
        description: message`Show commits before the specified date`,
      }),
    ),
    author: optional(
      option("--author", string({ metavar: "PATTERN" }), {
        description:
          message`Show commits by a specific author (partial name match)`,
      }),
    ),
    grep: optional(
      option("--grep", string({ metavar: "PATTERN" }), {
        description: message`Show commits with messages matching the pattern`,
      }),
    ),
  }),
);

/**
 * The complete log command parser.
 * Demonstrates:
 * - group() for organizing options in help text
 * - merge() for combining multiple option groups
 * - withDefault() for default values
 * - choice() for enumerated values
 * - map() for transforming parser results
 */
const logOptionsParser = map(
  merge(
    object({ command: constant("log" as const) }),
    displayOptions,
    filterOptions,
  ),
  (result) => ({
    ...result,
    // Handle --oneline shorthand by overriding format
    format: result.oneline ? ("oneline" as const) : result.format,
  }),
);

/**
 * The complete `gitique log` command parser with documentation.
 */
export const logCommand = command("log", logOptionsParser, {
  brief: message`Show commit history`,
  description:
    message`Show commit history in reverse chronological order. Use ${
      optionName("--oneline")
    } for compact output or ${
      optionName("--format")
    } to customize the display.`,
  footer: message`Examples:
  ${commandLine("gitique log")}                     Show recent commits
  ${
    commandLine("gitique log --oneline -n 5")
  }      Show 5 commits in one-line format
  ${commandLine("gitique log --format=full")}       Show full commit details
  ${commandLine("gitique log --author=john")}       Filter by author
  ${commandLine('gitique log --since="2024-01-01"')}  Show commits since date`,
});

/**
 * Type inference for the log command configuration.
 */
export type LogConfig = InferValue<typeof logCommand>;

/**
 * Parses a date string into a Date object.
 * Supports various formats like "2024-01-01", "2 days ago", etc.
 */
function parseDate(dateString: string): Date {
  // Simple implementation - in a real scenario, you'd want more robust date parsing
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: "${dateString}"`);
  }
  return date;
}

/**
 * Filters commits based on the provided criteria.
 */
function filterCommits(
  commits: Array<{ oid: string; commit: Commit }>,
  config: LogConfig,
): Array<{ oid: string; commit: Commit }> {
  let filtered = commits;

  // Filter by date range
  if (config.since) {
    const sinceDate = parseDate(config.since);
    filtered = filtered.filter(({ commit }) => {
      const commitDate = commit.time();
      return commitDate >= sinceDate;
    });
  }

  if (config.until) {
    const untilDate = parseDate(config.until);
    filtered = filtered.filter(({ commit }) => {
      const commitDate = commit.time();
      return commitDate <= untilDate;
    });
  }

  // Filter by author
  if (config.author) {
    const authorPattern = config.author.toLowerCase();
    filtered = filtered.filter(({ commit }) => {
      const author = commit.author();
      return (
        author.name.toLowerCase().includes(authorPattern) ||
        author.email.toLowerCase().includes(authorPattern)
      );
    });
  }

  // Filter by commit message
  if (config.grep) {
    const messagePattern = config.grep.toLowerCase();
    filtered = filtered.filter(({ commit }) => {
      const message = commit.message().toLowerCase();
      return message.includes(messagePattern);
    });
  }

  return filtered;
}

/**
 * Formats a commit in short format.
 */
function formatCommitShort(oid: string, commit: Commit): string {
  const author = commit.author();
  const summary = commit.message().split("\n")[0];
  return `commit ${
    oid.substring(0, 7)
  }\nAuthor: ${author.name}\n\n    ${summary}\n`;
}

/**
 * Formats a commit in full format.
 */
function formatCommitFull(oid: string, commit: Commit): string {
  const author = commit.author();
  const committer = commit.committer();
  const commitTime = commit.time();

  const lines = [
    `commit ${oid}`,
    `Author: ${author.name} <${author.email}>`,
    `Commit: ${committer.name} <${committer.email}>`,
    `Date:   ${commitTime.toDateString()}`,
    "",
    ...commit.message().split("\n").map((line: string) => `    ${line}`),
    "",
  ];

  return lines.join("\n");
}

/**
 * Executes the git log command with the parsed configuration.
 */
export async function executeLog(config: LogConfig): Promise<void> {
  try {
    const repo = await getRepository();

    // Get commit history
    const commits = getCommitHistory(repo, config.maxCount);

    if (commits.length === 0) {
      console.log("No commits found in the repository.");
      return;
    }

    // Apply filters
    const filteredCommits = filterCommits(commits, config);

    if (filteredCommits.length === 0) {
      console.log("No commits match the specified criteria.");
      return;
    }

    // Display commits in the requested format
    for (const { oid, commit } of filteredCommits) {
      switch (config.format) {
        case "oneline":
          console.log(formatCommitOneline(oid, commit));
          break;
        case "short":
          console.log(formatCommitShort(oid, commit));
          break;
        case "medium":
          console.log(formatCommitDetailed(oid, commit));
          break;
        case "full":
          console.log(formatCommitFull(oid, commit));
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
