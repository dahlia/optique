/**
 * Utility functions for formatting command output in a Git-like style.
 */
import process from "node:process";

/**
 * Colors for terminal output
 */
export const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
} as const;

import type { Commit } from "es-git";

/**
 * Formats a commit for log output (similar to git log --oneline)
 */
export function formatCommitOneline(oid: string, commit: Commit): string {
  const shortOid = oid.substring(0, 7);
  const summary = commit.message().split("\n")[0];
  return `${colors.yellow}${shortOid}${colors.reset} ${summary}`;
}

/**
 * Formats a commit for detailed log output (similar to git log)
 */
export function formatCommitDetailed(oid: string, commit: Commit): string {
  const author = commit.author();
  const message = commit.message();
  // Use author timestamp (when the change was authored), not committer time.
  const authorDate = new Date(author.timestamp * 1000);

  const lines = [
    `${colors.yellow}commit ${oid}${colors.reset}`,
    `Author: ${author.name} <${author.email}>`,
    `Date:   ${authorDate.toISOString()}`,
    "",
    ...message.split("\n").map((line: string) => `    ${line}`),
    "",
  ];

  return lines.join("\n");
}

/**
 * Formats file status for add command output
 */
export function formatAddedFile(filePath: string): string {
  return `${colors.green}add${colors.reset} '${filePath}'`;
}

/**
 * Formats commit creation message
 */
export function formatCommitCreated(
  oid: string,
  message: string,
  branchName: string,
): string {
  const shortOid = oid.substring(0, 7);
  const summary = message.split("\n")[0];
  return `[${branchName} ${colors.yellow}${shortOid}${colors.reset}] ${summary}`;
}

/**
 * Formats error messages
 */
export function formatError(message: string): string {
  return `${colors.red}error:${colors.reset} ${message}`;
}

/**
 * Formats warning messages
 */
export function formatWarning(message: string): string {
  return `${colors.yellow}warning:${colors.reset} ${message}`;
}

/**
 * Formats success messages
 */
export function formatSuccess(message: string): string {
  return `${colors.green}${message}${colors.reset}`;
}

/**
 * Formats file paths for consistent display
 */
export function formatFilePath(path: string): string {
  return `${colors.cyan}${path}${colors.reset}`;
}

/**
 * Formats timestamps for commit display
 */
export function formatTimestamp(date: Date): string {
  return date.toLocaleString();
}

/**
 * Strips color codes from text (useful for plain text output)
 */
export function stripColors(text: string): string {
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Checks if the current environment supports colors
 */
export function supportsColors(): boolean {
  // Simple check for color support
  return !!(
    process.stdout?.isTTY &&
    process.env.TERM !== "dumb" &&
    process.env.NO_COLOR !== "1"
  );
}

/**
 * Status indicator characters for git status output
 */
const statusIndicators: Record<string, string> = {
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
 * Formats a file status line for status command output (long format)
 */
export function formatStatusLong(
  path: string,
  status: string,
  staged: boolean,
  oldPath?: string,
): string {
  const statusColor = staged ? colors.green : colors.red;
  const statusText = status.toLowerCase();

  if (oldPath) {
    return `${statusColor}        ${statusText}:   ${oldPath} -> ${path}${colors.reset}`;
  }
  return `${statusColor}        ${statusText}:   ${path}${colors.reset}`;
}

/**
 * Formats diff statistics summary
 */
export function formatDiffStats(
  filesChanged: number,
  insertions: number,
  deletions: number,
): string {
  const parts: string[] = [];

  if (filesChanged > 0) {
    parts.push(`${filesChanged} file${filesChanged === 1 ? "" : "s"} changed`);
  }
  if (insertions > 0) {
    parts.push(
      `${colors.green}${insertions} insertion${
        insertions === 1 ? "" : "s"
      }(+)${colors.reset}`,
    );
  }
  if (deletions > 0) {
    parts.push(
      `${colors.red}${deletions} deletion${
        deletions === 1 ? "" : "s"
      }(-)${colors.reset}`,
    );
  }

  return parts.join(", ");
}

/**
 * Formats a diff delta for --name-only output
 */
export function formatDiffNameOnly(path: string): string {
  return path;
}

/**
 * Formats a diff delta for --name-status output
 */
export function formatDiffNameStatus(
  path: string,
  status: string,
  oldPath?: string,
): string {
  const indicator = statusIndicators[status] || "?";
  if (oldPath) {
    return `${indicator}\t${oldPath}\t${path}`;
  }
  return `${indicator}\t${path}`;
}

/**
 * Formats a diff delta for --stat output
 */
export function formatDiffStat(
  path: string,
  insertions: number,
  deletions: number,
  maxWidth: number = 50,
): string {
  const total = insertions + deletions;
  const barWidth = Math.min(total, maxWidth);
  const insertionBars = Math.round((insertions / total) * barWidth) || 0;
  const deletionBars = barWidth - insertionBars;

  const bar = `${colors.green}${
    "+".repeat(insertionBars)
  }${colors.reset}${colors.red}${"-".repeat(deletionBars)}${colors.reset}`;

  return ` ${path} | ${total} ${bar}`;
}
