import { object } from "@optique/core/constructs";
import { multiple } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { path, print, printError } from "@optique/run";
import { addAllFiles, addFile, getRepository } from "../utils/git.ts";
import {
  formatAddedFile,
  formatError,
  formatSuccess,
} from "../utils/formatters.ts";

/**
 * Configuration for the `gitique add` command.
 * Uses Optique's type system to ensure type-safe command parsing.
 */
const addOptions = object({
  command: constant("add" as const),
  all: option("-A", "--all", {
    description: message`Add all files in the working directory to the index`,
  }),
  force: option("-f", "--force", {
    description:
      message`Force adding files, even if they would normally be ignored`,
  }),
  verbose: option("-v", "--verbose", {
    description: message`Show detailed output during the add operation`,
  }),
  files: multiple(argument(path({ metavar: "FILE" }), {
    description: message`Files to add to the index`,
  })),
});

/**
 * The complete `gitique add` command parser.
 * Combines the command name with options and arguments.
 */
export const addCommand = command("add", addOptions, {
  description: message`Add file contents to the index for the next commit`,
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
        print(message`Adding all files to the index...`);
      }

      addAllFiles(repo);

      if (config.verbose) {
        print(
          message`${
            formatSuccess("Successfully added all files to the index")
          }`,
        );
      }
    } else if (config.files.length > 0) {
      // Add specific files
      for (const file of config.files) {
        try {
          addFile(repo, file);

          if (config.verbose) {
            print(message`${formatAddedFile(file)}`);
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
        print(
          message`${
            formatSuccess(
              `Successfully added ${config.files.length} file(s) to the index`,
            )
          }`,
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
