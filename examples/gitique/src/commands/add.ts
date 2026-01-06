import { group, merge, object } from "@optique/core/constructs";
import { multiple } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { path, printError } from "@optique/run";
import { addAllFiles, addFile, getRepository } from "../utils/git.ts";
import {
  formatAddedFile,
  formatError,
  formatSuccess,
} from "../utils/formatters.ts";

/**
 * Staging options for the add command.
 * Demonstrates Optique's group() combinator for organizing help text.
 */
const stagingOptions = group(
  "Staging Options",
  object({
    all: option("-A", "--all", {
      description: message`Add all files in the working directory to the index`,
    }),
    force: option("-f", "--force", {
      description:
        message`Force adding files, even if they would normally be ignored`,
    }),
  }),
);

/**
 * Output options for the add command.
 */
const outputOptions = group(
  "Output Options",
  object({
    verbose: option("-v", "--verbose", {
      description: message`Show detailed output during the add operation`,
    }),
  }),
);

/**
 * The complete add command parser.
 * Demonstrates:
 * - group() for organizing options in help text
 * - merge() for combining multiple option groups
 * - multiple() for variadic positional arguments
 */
const addOptionsParser = merge(
  object({ command: constant("add" as const) }),
  stagingOptions,
  outputOptions,
  object({
    files: multiple(
      argument(path({ metavar: "FILE" }), {
        description: message`Files to add to the index`,
      }),
    ),
  }),
);

/**
 * The complete `gitique add` command parser with documentation.
 */
export const addCommand = command("add", addOptionsParser, {
  brief: message`Add file contents to the index`,
  description: message`Add file contents to the index for the next commit`,
  footer: message`Examples:
  gitique add .              Add all files in current directory
  gitique add -A             Add all files (including deletions)
  gitique add file1.ts       Add a specific file
  gitique add -v *.ts        Add files with verbose output`,
});

/**
 * Type inference for the add command configuration.
 * This provides full TypeScript type safety for the parsed options.
 */
export type AddConfig = InferValue<typeof addCommand>;

/**
 * Executes the git add command with the parsed configuration.
 *
 * @param config - Type-safe configuration parsed by Optique
 */
export async function executeAdd(config: AddConfig): Promise<void> {
  try {
    const repo = await getRepository();

    if (config.all) {
      // Add all files (equivalent to `git add .`)
      if (config.verbose) {
        console.log("Adding all files to the index...");
      }

      addAllFiles(repo);

      if (config.verbose) {
        console.log(formatSuccess("Successfully added all files to the index"));
      }
    } else if (config.files.length > 0) {
      // Add specific files
      for (const file of config.files) {
        try {
          addFile(repo, file);

          if (config.verbose) {
            console.log(formatAddedFile(file));
          }
        } catch (error) {
          printError(
            message`${
              formatError(
                `Failed to add '${file}': ${
                  error instanceof Error ? error.message : String(error)
                }`,
              )
            }`,
            config.force ? undefined : { exitCode: 1 },
          );
        }
      }

      if (config.verbose) {
        console.log(
          formatSuccess(
            `Successfully added ${config.files.length} file(s) to the index`,
          ),
        );
      }
    } else {
      // No files specified and --all not used
      throw new Error(
        "Nothing specified, nothing added.\nMaybe you wanted to say 'gitique add .'?",
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
