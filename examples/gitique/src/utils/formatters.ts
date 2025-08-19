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
  const commitTime = commit.time();

  const lines = [
    `${colors.yellow}commit ${oid}${colors.reset}`,
    `Author: ${author.name} <${author.email}>`,
    `Date:   ${commitTime.toDateString()}`,
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
export function formatCommitCreated(oid: string, message: string): string {
  const shortOid = oid.substring(0, 7);
  const summary = message.split("\n")[0];
  return `[main ${colors.yellow}${shortOid}${colors.reset}] ${summary}`;
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
