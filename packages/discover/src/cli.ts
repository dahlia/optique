/**
 * CLI entry point for optique-discover.
 * @module
 */
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { argument, option } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import { string } from "@optique/core/valueparser";
import { printError, runSync } from "@optique/run";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { watchCommandsModule, writeCommandsModule } from "./generator.ts";
// @ts-ignore: JSON import
import denoJson from "../deno.json" with { type: "json" };

const EXIT_GENERATION_FAILED = 1;
const EXIT_INVALID_OPTIONS = 2;

const cliProgram = defineProgram({
  parser: object({
    dir: argument(string({ metavar: "DIR" }), {
      description: message`Directory containing command modules.`,
    }),
    outputFile: option("-o", "--output", string({ metavar: "FILE" }), {
      description: message`Generated TypeScript module path.`,
    }),
    base: optional(
      option("--base", string({ metavar: "PATH" }), {
        description:
          message`Module map base path passed to commandsFromModules().
Defaults to the command directory relative to the generated module.`,
      }),
    ),
    extensions: withDefault(
      multiple(option("--extension", string({ metavar: "EXT" }))),
      [],
    ),
    entryFileName: optional(
      option("--entry-file-name", string({ metavar: "NAME" }), {
        description: message`File name that maps to the containing command path.
Defaults to commandsFromModules() behavior.`,
      }),
    ),
    noEntryFileName: option("--no-entry-file-name", {
      description: message`Treat entry files as ordinary command names.`,
    }),
    watch: option("--watch", {
      description: message`Regenerate when command files are added, removed,
or renamed.`,
    }),
  }),
  metadata: {
    name: "optique-discover",
    version: denoJson.version,
    brief: message`Generate static command modules for @optique/discover`,
  },
});

/**
 * Runs the optique-discover command-line interface.
 *
 * @returns A promise that resolves after generation or watch mode finishes.
 * @since 1.2.0
 */
export async function main(): Promise<void> {
  const args = runSync(cliProgram, {
    help: "option",
    version: {
      value: denoJson.version,
      option: true,
    },
  });
  if (args.noEntryFileName && args.entryFileName != null) {
    printError(
      message`Use either --entry-file-name or --no-entry-file-name, not both.`,
      { exitCode: EXIT_INVALID_OPTIONS },
    );
    return;
  }

  const options = {
    dir: args.dir,
    outputFile: args.outputFile,
    ...(args.base != null ? { base: args.base } : {}),
    ...(args.extensions.length > 0 ? { extensions: args.extensions } : {}),
    ...(args.noEntryFileName
      ? { entryFileName: false as const }
      : args.entryFileName != null
      ? { entryFileName: args.entryFileName }
      : {}),
  };

  try {
    if (args.watch) {
      await watchCommandsModule({
        ...options,
        onGenerate(result) {
          writeGeneratedMessage(result.files.length);
        },
        onError(error) {
          printGenerationError(error);
        },
      });
    } else {
      const result = await writeCommandsModule(options);
      writeGeneratedMessage(result.files.length);
    }
  } catch (error) {
    printGenerationError(error, EXIT_GENERATION_FAILED);
  }
}

function printGenerationError(error: unknown, exitCode?: number): void {
  const messageText = error instanceof Error ? error.message : String(error);
  if (exitCode == null) {
    printError(message`Failed to generate command module: ${messageText}`);
  } else {
    printError(
      message`Failed to generate command module: ${messageText}`,
      { exitCode },
    );
  }
}

function writeGeneratedMessage(count: number): void {
  const noun = count === 1 ? "command module" : "command modules";
  // deno-lint-ignore no-console
  console.log(`Generated ${count} ${noun}.`);
}

const isMain: boolean = "main" in import.meta
  ? import.meta.main
  : process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  void main().catch((error) => {
    printGenerationError(error, EXIT_GENERATION_FAILED);
  });
}
