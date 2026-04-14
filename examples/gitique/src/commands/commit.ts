import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { group, merge, object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import {
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import {
  commandLine,
  lineBreak,
  message,
  metavar,
  optionName,
  optionNames,
  text,
} from "@optique/core/message";
import { print } from "@optique/run";
import {
  createCommit,
  createGitSignature,
  getRepository,
  isIndexEmpty,
  stageTrackedFiles,
} from "../utils/git.ts";
import { formatCommitCreated } from "../utils/formatters.ts";
import { exitWithError } from "../utils/output.ts";

export interface AuthorIdentity {
  readonly name: string;
  readonly email: string;
}

const authorPattern = /^([^<]+)\s*<([^>]+)>$/;

function parseAuthorIdentity(input: string): ValueParserResult<AuthorIdentity> {
  const match = input.match(authorPattern);
  const name = match?.[1]?.trim() ?? "";
  const email = match?.[2]?.trim() ?? "";
  if (!name || !email) {
    return {
      success: false,
      error: message`Invalid author ${input}. Use ${text("Name <email>")}.`,
    };
  }
  return { success: true, value: { name, email } };
}

const authorParser: ValueParser<"sync", AuthorIdentity> = {
  mode: "sync",
  metavar: "AUTHOR",
  placeholder: { name: "Jane Doe", email: "jane@example.com" },
  parse: parseAuthorIdentity,
  format(value: AuthorIdentity): string {
    return `${value.name} <${value.email}>`;
  },
};

/**
 * Commit options for the commit command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const commitOptions = group(
  "Commit Options",
  object({
    message: option(
      "-m",
      "--message",
      string({
        metavar: "MESSAGE",
        pattern: /\S/,
        errors: {
          patternMismatch:
            message`Commit message must contain non-whitespace characters.`,
        },
      }),
      {
        description: message`Commit message`,
        errors: {
          missing: (names) =>
            message`Use ${optionNames(names)} to provide a commit message.`,
          endOfInput: message`${optionNames(["-m", "--message"])} requires ${
            metavar("MESSAGE")
          }.`,
        },
      },
    ),
    all: option("-a", "--all", {
      description:
        message`Automatically stage all modified and deleted files before committing`,
    }),
    allowEmpty: option("--allow-empty", {
      description: message`Allow creating a commit with no changes`,
    }),
  }),
);

/**
 * Author options for the commit command.
 */
const authorOptions = group(
  "Author Options",
  object({
    author: optional(
      option("--author", authorParser, {
        description:
          message`Override the commit author (format: "Name <email>")`,
        errors: {
          endOfInput: message`${optionName("--author")} requires ${
            metavar("AUTHOR")
          }.`,
          invalidValue: (error) =>
            message`${optionName("--author")} is invalid: ${error}`,
        },
      }),
    ),
  }),
);

/**
 * The complete commit command parser.
 * Demonstrates:
 * - group() for organizing options in help text
 * - merge() for combining multiple option groups
 * - optional() for optional values
 */
const commitOptionsParser = merge(
  object({ command: constant("commit" as const) }),
  commitOptions,
  authorOptions,
);

/**
 * The complete `gitique commit` command parser with documentation.
 */
export const commitCommand = command("commit", commitOptionsParser, {
  brief: message`Record changes to the repository`,
  description: message`Record changes to the repository with a commit. Use ${
    optionName("-m")
  } to provide a commit message.`,
  footer: message`Examples:${lineBreak()}
  ${commandLine('gitique commit -m "Initial commit"')}${lineBreak()}
  ${commandLine('gitique commit -a -m "Fix bug"')}${lineBreak()}
  ${
    commandLine(
      'gitique commit --author "John <john@example.com>" -m "Co-authored"',
    )
  }${lineBreak()}
  ${commandLine('gitique commit --allow-empty -m "Empty commit"')}`,
});

/**
 * Type inference for the commit command configuration.
 */
export type CommitConfig = InferValue<typeof commitCommand>;

/**
 * Executes the git commit command with the parsed configuration.
 */
export async function executeCommit(config: CommitConfig): Promise<void> {
  try {
    const repo = await getRepository();

    // Stage tracked (modified/deleted) files if --all option is used.
    // Use stageTrackedFiles (index.updateAll) rather than addAllFiles so
    // that untracked files are not accidentally staged, matching git -a.
    if (config.all) {
      print(message`Staging all modified and deleted files.`);
      stageTrackedFiles(repo);
    }

    // Reject empty commits unless --allow-empty is set
    if (!config.allowEmpty && isIndexEmpty(repo)) {
      throw new Error(
        "nothing to commit (create/copy files and use 'gitique add' to track).",
      );
    }

    const commitMessage = config.message.trim();
    if (!commitMessage) {
      throw new Error(
        "Aborting commit due to empty commit message.",
      );
    }

    // Create author signature; pass repo so local config is checked first.
    let authorSignature;
    if (config.author) {
      authorSignature = createGitSignature(
        config.author.name,
        config.author.email,
        repo,
      );
    } else {
      authorSignature = createGitSignature(undefined, undefined, repo);
    }

    // Committer is always the default identity; only the author can be
    // overridden with --author.
    const committerSignature = createGitSignature(undefined, undefined, repo);

    // Create the commit
    const commitOid = createCommit(
      repo,
      commitMessage,
      authorSignature,
      committerSignature,
    );

    // Resolve branch name for the commit header.
    // After creating a root commit on an unborn branch, repo.head() may
    // still fail to resolve if it isn't cached yet; read .git/HEAD directly
    // as a fallback so the output shows the real branch name.
    let branchName = "(detached)";
    if (!repo.headDetached()) {
      try {
        branchName = repo.head().name().replace("refs/heads/", "");
      } catch {
        // Unborn/just-created branch — read from .git/HEAD directly
        try {
          const headContent = readFileSync(
            resolve(repo.path(), "HEAD"),
            "utf-8",
          ).trim();
          if (headContent.startsWith("ref: refs/heads/")) {
            branchName = headContent.slice("ref: refs/heads/".length);
          }
        } catch {
          // Unable to determine branch name
        }
      }
    }

    // Output success message
    console.log(formatCommitCreated(commitOid, commitMessage, branchName));

    // Show commit details using the actual commit timestamp
    const commit = repo.getCommit(commitOid);
    const author = commit.author();
    console.log(`Author: ${author.name} <${author.email}>`);
    console.log(`Date: ${new Date(author.timestamp * 1000).toISOString()}`);

    if (config.all) {
      print(message`Changes were automatically staged and committed.`);
    }
  } catch (error) {
    exitWithError(error);
  }
}
