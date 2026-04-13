import { group, merge, object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import {
  commandLine,
  lineBreak,
  message,
  optionName,
} from "@optique/core/message";
import { printError } from "@optique/run";
import {
  createCommit,
  createGitSignature,
  getRepository,
  isIndexEmpty,
  stageTrackedFiles,
} from "../utils/git.ts";
import {
  formatCommitCreated,
  formatError,
  formatSuccess,
} from "../utils/formatters.ts";

/**
 * Commit options for the commit command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const commitOptions = group(
  "Commit Options",
  object({
    message: option("-m", "--message", string({ metavar: "MESSAGE" }), {
      description: message`Commit message`,
    }),
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
      option("--author", string({ metavar: "AUTHOR" }), {
        description:
          message`Override the commit author (format: "Name <email>")`,
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
 * Parses author string in the format "Name <email>".
 */
function parseAuthor(authorString: string): { name: string; email: string } {
  const match = authorString.match(/^(.+?)\s*<(.+?)>$/);
  const name = match?.[1].trim() ?? "";
  const email = match?.[2].trim() ?? "";
  if (!name || !email) {
    throw new Error(
      `Invalid author format: "${authorString}". Expected format: "Name <email>"`,
    );
  }
  return { name, email };
}

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
      console.log("Staging all modified and deleted files...");
      stageTrackedFiles(repo);
    }

    // Reject empty commits unless --allow-empty is set
    if (!config.allowEmpty && isIndexEmpty(repo)) {
      throw new Error(
        "nothing to commit (create/copy files and use 'git add' to track)",
      );
    }

    const commitMessage = config.message;

    // Create author signature; pass repo so local config is checked first.
    let authorSignature;
    if (config.author) {
      const { name, email } = parseAuthor(config.author);
      authorSignature = createGitSignature(name, email, repo);
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

    // Resolve branch name for the commit header
    let branchName = "(detached)";
    if (!repo.headDetached()) {
      try {
        branchName = repo.head().name().replace("refs/heads/", "");
      } catch {
        // Unborn branch — keep "(detached)" default
      }
    }

    // Output success message
    console.log(formatCommitCreated(commitOid, commitMessage, branchName));

    // Show commit details using the actual commit timestamp
    const commit = repo.getCommit(commitOid);
    const author = commit.author();
    console.log(`Author: ${author.name} <${author.email}>`);
    console.log(`Date: ${commit.time().toISOString()}`);

    if (config.all) {
      console.log(formatSuccess("Changes automatically staged and committed"));
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
