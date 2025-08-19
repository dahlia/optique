import {
  command,
  constant,
  type InferValue,
  object,
  option,
  optional,
} from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import process from "node:process";
import { getCommitHistory, getRepository } from "../utils/git.ts";
import {
  formatCommitDetailed,
  formatCommitOneline,
  formatError,
} from "../utils/formatters.ts";
import type { Commit } from "es-git";

/**
 * Configuration for the `gitique log` command.
 * Demonstrates Optique's optional() combinator for optional parameters.
 */
const logOptions = object({
  command: constant("log" as const),
  oneline: option("--oneline", {
    description:
      message`Show each commit on a single line with short hash and message`,
  }),
  maxCount: optional(
    option("-n", "--max-count", integer({ metavar: "NUMBER" }), {
      description: message`Limit the number of commits to show`,
    }),
  ),
  since: optional(option("--since", string({ metavar: "DATE" }), {
    description: message`Show commits after the specified date`,
  })),
  until: optional(option("--until", string({ metavar: "DATE" }), {
    description: message`Show commits before the specified date`,
  })),
  author: optional(option("--author", string({ metavar: "PATTERN" }), {
    description:
      message`Show commits by a specific author (partial name match)`,
  })),
  grep: optional(option("--grep", string({ metavar: "PATTERN" }), {
    description: message`Show commits with messages matching the pattern`,
  })),
});

/**
 * The complete `gitique log` command parser.
 */
export const logCommand = command("log", logOptions, {
  description: message`Show commit history in reverse chronological order`,
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
      return author.name.toLowerCase().includes(authorPattern) ||
        author.email.toLowerCase().includes(authorPattern);
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
      if (config.oneline) {
        console.log(formatCommitOneline(oid, commit));
      } else {
        console.log(formatCommitDetailed(oid, commit));
      }
    }
  } catch (error) {
    console.error(
      formatError(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
