import {
  argument,
  command,
  constant,
  type InferValue,
  multiple,
  object,
  option,
} from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import process from "node:process";
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
  files: multiple(argument(string({ metavar: "FILE" }), {
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
          console.error(formatError(
            `Failed to add '${file}': ${
              error instanceof Error ? error.message : String(error)
            }`,
          ));

          if (!config.force) {
            process.exit(1);
          }
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
    console.error(
      formatError(error instanceof Error ? error.message : String(error)),
    );
    process.exit(1);
  }
}
