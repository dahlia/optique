import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, printError } from "@optique/run";
import {
  addAllFiles,
  createCommit,
  createGitSignature,
  getRepository,
} from "../utils/git.ts";
import {
  formatCommitCreated,
  formatError,
  formatSuccess,
} from "../utils/formatters.ts";

/**
 * Configuration for the `gitique commit` command.
 * Uses Optique's object() combinator to create a type-safe configuration.
 */
const commitOptions = object({
  command: constant("commit" as const),
  message: optional(option("-m", "--message", string({ metavar: "MESSAGE" }), {
    description: message`Commit message to use for this commit`,
  })),
  author: optional(option("--author", string({ metavar: "AUTHOR" }), {
    description: message`Override the commit author (format: "Name <email>")`,
  })),
  all: option("-a", "--all", {
    description:
      message`Automatically stage all modified and deleted files before committing`,
  }),
  allowEmpty: option("--allow-empty", {
    description: message`Allow creating a commit with no changes`,
  }),
});

/**
 * The complete `gitique commit` command parser.
 */
export const commitCommand = command("commit", commitOptions, {
  description: message`Record changes to the repository with a commit`,
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
  if (!match) {
    throw new Error(
      `Invalid author format: "${authorString}". Expected format: "Name <email>"`,
    );
  }

  return {
    name: match[1].trim(),
    email: match[2].trim(),
  };
}

/**
 * Prompts user for commit message if not provided via -m option.
 * In a real implementation, this would open an editor.
 */
function getCommitMessage(providedMessage?: string): string {
  if (providedMessage) {
    return providedMessage;
  }

  // In a real implementation, we would open an editor like vim/nano
  // For this example, we'll require the message to be provided via -m
  throw new Error(
    "Aborting commit due to empty commit message.\n" +
      "Please use 'gitique commit -m \"your message\"' to provide a commit message.",
  );
}

/**
 * Executes the git commit command with the parsed configuration.
 */
export async function executeCommit(config: CommitConfig): Promise<void> {
  try {
    const repo = await getRepository();

    // Stage all files if --all option is used
    if (config.all) {
      print(message`Staging all modified and deleted files...`);
      await addAllFiles(repo);
    }

    // Get commit message
    const commitMessage = getCommitMessage(config.message);

    // Create author signature
    let authorSignature;
    if (config.author) {
      const { name, email } = parseAuthor(config.author);
      authorSignature = createGitSignature(name, email);
    } else {
      authorSignature = createGitSignature();
    }

    // Create the commit
    const commitOid = createCommit(
      repo,
      commitMessage,
      authorSignature,
      authorSignature, // Use same signature for committer
    );

    // Output success message
    print(message`${formatCommitCreated(commitOid, commitMessage)}`);

    // Show commit details
    const commit = repo.getCommit(commitOid);
    const author = commit.author();
    print(message`Author: ${author.name} <${author.email}>`);
    print(message`Date: ${new Date().toISOString()}`);

    if (config.all) {
      print(
        message`${formatSuccess("Changes automatically staged and committed")}`,
      );
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
