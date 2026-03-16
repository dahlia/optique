/**
 * CLI entry point for optique-man.
 * @module
 */
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";
import { optional, withDefault } from "@optique/core/modifiers";
import {
  commandLine,
  message,
  metavar,
  optionName,
  url,
} from "@optique/core/message";
import type { Message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import type { Program } from "@optique/core/program";
import type { Mode, Parser } from "@optique/core/parser";
import { printError, runSync } from "@optique/run";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateManPageAsync } from "./generator.ts";
// @ts-ignore: JSON import
import denoJson from "../deno.json" with { type: "json" };

// Pattern matching JSX/TSX file extensions (including module-prefixed variants)
const jsxTsxPattern = /\.[mc]?[jt]sx$/;

// Exit codes
const EXIT_FILE_NOT_FOUND = 1;
const EXIT_EXPORT_NOT_FOUND = 2;
const EXIT_NOT_PROGRAM_OR_PARSER = 3;
const EXIT_TSX_REQUIRED = 4;
const EXIT_GENERATION_FAILED = 5;
const EXIT_WRITE_FAILED = 6;

// Section values as a const array for type inference
const sectionValues = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * CLI program definition for optique-man.
 */
const cliProgram = defineProgram({
  parser: object({
    file: argument(string({ metavar: "FILE" }), {
      description: message`Path to a TypeScript or JavaScript file that exports
a ${metavar("PROGRAM")} or ${metavar("PARSER")} to generate a man page from.`,
    }),
    section: option(
      "-s",
      "--section",
      choice(sectionValues, { metavar: "SECTION" }),
      {
        description:
          message`Man page section number (${"1"}-${"8"}). Common sections:

  ${"1"}  User commands
  ${"5"}  File formats
  ${"8"}  System administration`,
      },
    ),
    exportName: withDefault(
      option("-e", "--export", string({ metavar: "NAME" }), {
        description: message`JavaScript export name to use. The export must be
a ${metavar("PROGRAM")} (from ${commandLine("defineProgram()")}) or
a ${metavar("PARSER")}. If not specified, the default export is used.`,
      }),
      "default",
    ),
    output: optional(
      option("-o", "--output", string({ metavar: "PATH" }), {
        description: message`Output file path. If not specified, the man page
is written to stdout.`,
      }),
    ),
    name: optional(
      option(
        "--name",
        string({
          metavar: "NAME",
          pattern: /.+/,
          errors: {
            patternMismatch: message`Program name must not be empty.`,
          },
        }),
        {
          description: message`Program name to use in the man page header.
If not specified, inferred from the ${metavar("PROGRAM")} metadata
or the input file name.`,
        },
      ),
    ),
    date: optional(
      option(
        "--date",
        string({
          metavar: "DATE",
          pattern: /.+/,
          errors: { patternMismatch: message`Date must not be empty.` },
        }),
        {
          description: message`Date to display in the man page footer.
Defaults to the current date.`,
        },
      ),
    ),
    versionString: optional(
      option(
        "--version-string",
        string({
          metavar: "VERSION",
          pattern: /.+/,
          errors: {
            patternMismatch: message`Version string must not be empty.`,
          },
        }),
        {
          description: message`Version string for the man page footer
(e.g., ${"MyApp 1.0.0"}). Overrides the version from
${metavar("PROGRAM")} metadata if provided.`,
        },
      ),
    ),
    manual: optional(
      option(
        "--manual",
        string({
          metavar: "TITLE",
          pattern: /.+/,
          errors: {
            patternMismatch: message`Manual name must not be empty.`,
          },
        }),
        {
          description: message`Manual name for the man page header
(e.g., ${"User Commands"}).`,
        },
      ),
    ),
  }),
  metadata: {
    name: "optique-man",
    version: denoJson.version,
    brief: message`Generate Unix man pages from Optique parsers`,
    description: message`Generates a Unix man page from an Optique
${metavar("PROGRAM")} or ${metavar("PARSER")} exported from a TypeScript
or JavaScript file.

The input file should export a ${metavar("PROGRAM")} (created with
${commandLine("defineProgram()")}) or a ${metavar("PARSER")}. When using
a ${metavar("PROGRAM")}, metadata like name, version, author, and examples
are automatically extracted.`,
    examples: message`Generate a man page for section ${"1"} (user commands):

  ${commandLine("optique-man ./src/cli.ts -s 1")}

Use a named export instead of the default export:

  ${commandLine("optique-man ./src/cli.ts -s 1 -e myProgram")}

Write output to a file:

  ${commandLine("optique-man ./src/cli.ts -s 1 -o myapp.1")}

Override the program name:

  ${commandLine("optique-man ./src/cli.ts -s 1 --name myapp")}`,
    bugs: message`Report bugs to: ${
      url("https://github.com/dahlia/optique/issues")
    }.`,
  },
});

/**
 * Gets the Node.js major and minor version numbers.
 * @returns A tuple of [major, minor] or null if not running on Node.js.
 */
function getNodeMajorMinor(): [number, number] | null {
  if (typeof process === "undefined" || !process.versions?.node) {
    return null;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  return [major, minor];
}

/**
 * Checks if Node.js natively supports TypeScript via type stripping.
 * Node.js 25.2.0+ has type stripping enabled by default.
 * @returns true if native TypeScript is supported.
 */
function nodeSupportsNativeTypeScript(): boolean {
  const version = getNodeMajorMinor();
  if (version == null) return false;
  const [major, minor] = version;
  // Node.js 25.2.0+ has type stripping enabled by default
  return major > 25 || (major === 25 && minor >= 2);
}

/**
 * Error handler for file not found.
 */
function fileNotFoundError(filePath: string): never {
  printError(
    message`File ${filePath} not found.

Make sure the file path is correct and the file exists.`,
    { exitCode: EXIT_FILE_NOT_FOUND },
  );
}

/**
 * Error handler for export not found.
 */
function exportNotFoundError(
  filePath: string,
  exportName: string,
  availableExports: readonly string[],
): never {
  const exportDisplay = exportName === "default"
    ? "default export"
    : `export ${exportName}`;

  let suggestion: Message;
  if (availableExports.length > 0) {
    suggestion = message`

Available exports: ${availableExports.join(", ")}.
Use ${optionName("-e")} to specify one of these exports.`;
  } else {
    suggestion = message`

The file has no exports. Make sure it exports a Program or Parser.`;
  }

  printError(
    message`No ${exportDisplay} found in ${filePath}.${suggestion}`,
    { exitCode: EXIT_EXPORT_NOT_FOUND },
  );
}

/**
 * Error handler for invalid export type.
 */
function notProgramOrParserError(
  filePath: string,
  exportName: string,
  actualType: string,
): never {
  const exportDisplay = exportName === "default"
    ? "default export"
    : `export ${exportName}`;

  printError(
    message`The ${exportDisplay} in ${filePath} is not a Program or Parser.

Got type: ${actualType}

The export should be created with ${commandLine("defineProgram()")} or be
an Optique parser (e.g., from ${commandLine("object()")},
${commandLine("command()")}, etc.).`,
    { exitCode: EXIT_NOT_PROGRAM_OR_PARSER },
  );
}

/**
 * Error handler for missing tsx for TypeScript files.
 */
function tsxRequiredError(filePath: string): never {
  const version = getNodeMajorMinor();
  const versionStr = version ? `${version[0]}.${version[1]}` : "unknown";

  printError(
    message`TypeScript file ${filePath} cannot be loaded on Node.js ${versionStr}.

Install tsx as a dev dependency:

  ${commandLine("npm install -D tsx")}

Or upgrade to Node.js 25.2.0 or later, which supports TypeScript natively.

Alternatively, use a pre-compiled JavaScript file instead.`,
    { exitCode: EXIT_TSX_REQUIRED },
  );
}

/**
 * Error handler for missing tsx for JSX/TSX files.
 */
function jsxLoaderRequiredError(filePath: string): never {
  const version = getNodeMajorMinor();
  const versionStr = version ? `${version[0]}.${version[1]}` : "unknown";

  const isTsx = /\.[mc]?tsx$/.test(filePath);
  const fileKind = isTsx ? "TSX" : "JSX";

  printError(
    message`${fileKind} file ${filePath} cannot be loaded on Node.js ${versionStr}.

Install tsx as a dev dependency:

  ${commandLine("npm install -D tsx")}

Alternatively, use a pre-compiled JavaScript file instead.`,
    { exitCode: EXIT_TSX_REQUIRED },
  );
}

/**
 * Error handler for man page generation failure.
 */
function generationError(error: Error): never {
  printError(
    message`Failed to generate man page: ${error.message}`,
    { exitCode: EXIT_GENERATION_FAILED },
  );
}

/**
 * Error handler for file write failure.
 */
function writeError(outputPath: string, error: Error): never {
  printError(
    message`Failed to write to ${outputPath}: ${error.message}

Make sure you have write permission and the parent directory exists.`,
    { exitCode: EXIT_WRITE_FAILED },
  );
}

/**
 * Imports a module from the given file path.
 * Handles TypeScript and JSX files on Node.js by using tsx if needed.
 * @param filePath The path to the module file.
 * @returns The imported module's exports.
 * @throws If the module fails to import for reasons other than a missing
 *         tsx loader (which causes the process to exit instead).
 */
async function importModule(
  filePath: string,
): Promise<Record<string, unknown>> {
  const absolutePath = resolve(filePath);

  // Check if file exists
  if (!existsSync(absolutePath)) {
    fileNotFoundError(filePath);
  }

  const isPlainTs = /\.[mc]?ts$/.test(filePath);
  const isJsxOrTsx = jsxTsxPattern.test(filePath);
  const isDeno = "Deno" in globalThis;
  const isBun = "Bun" in globalThis;

  // Node.js + TypeScript/JSX: JSX files always need tsx (Node's native type
  // stripping does not handle JSX transform), while plain TS files only need
  // it on older Node versions without native type stripping.
  if (
    !isDeno && !isBun &&
    (isJsxOrTsx || (isPlainTs && !nodeSupportsNativeTypeScript()))
  ) {
    await registerTsx(filePath, isJsxOrTsx);
  } else if (!isDeno && !isBun) {
    // Any Node.js entry (including .js and .ts on Node 25.2+) may have
    // transitive JSX/TSX dependencies that need tsx.  Register it
    // opportunistically so the loader is in place before the first
    // import — Node's ESM loader caches failed module jobs, so a
    // post-failure retry would not work.
    await tryRegisterTsx();
  }

  // Use file URL for proper import on all platforms
  const fileUrl = pathToFileURL(absolutePath).href;
  try {
    return await import(fileUrl);
  } catch (error: unknown) {
    // If the import failed with ERR_UNKNOWN_FILE_EXTENSION for a JSX/TSX
    // dependency and tsx is not installed, show a helpful error message
    // instead of the raw Node.js error.
    if (
      !isDeno && !isBun &&
      isNodeError(error) &&
      error.code === "ERR_UNKNOWN_FILE_EXTENSION"
    ) {
      const failedPath = extractPathFromExtensionError(error.message);
      if (failedPath != null && jsxTsxPattern.test(failedPath)) {
        jsxLoaderRequiredError(failedPath);
      }
    }
    throw error;
  }
}

/**
 * Checks whether an error is a Node.js system error with a string `code`.
 * @param error The value to check.
 * @returns `true` if the error has a string `code` property.
 */
function isNodeError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error &&
    typeof (error as { code: unknown }).code === "string";
}

/**
 * Extracts the file path from a Node.js `ERR_UNKNOWN_FILE_EXTENSION` error
 * message, which has the format `Unknown file extension ".ext" for /path`.
 * @param message The error message string.
 * @returns The file path, or null if the message format is unexpected.
 */
function extractPathFromExtensionError(message: string): string | null {
  const match = /^Unknown file extension "\.[^"]*" for (.+)$/.exec(message);
  return match?.[1] ?? null;
}

/**
 * Registers the tsx loader for TypeScript/JSX/TSX support on Node.js.
 * @param filePath The file path being loaded (used for error messages).
 * @param isJsxOrTsx Whether the file uses a JSX or TSX extension.
 */
async function registerTsx(
  filePath: string,
  isJsxOrTsx: boolean,
): Promise<void> {
  try {
    const tsx = await import("tsx/esm/api");
    tsx.register();
  } catch (error: unknown) {
    if (
      !isNodeError(error) ||
      error.code !== "ERR_MODULE_NOT_FOUND"
    ) {
      throw error;
    }
    if (isJsxOrTsx) {
      jsxLoaderRequiredError(filePath);
    } else {
      tsxRequiredError(filePath);
    }
  }
}

/**
 * Tries to register the tsx loader, silently ignoring all failures.
 * Used on Node.js for entries that may have transitive JSX/TSX dependencies.
 *
 * All errors are suppressed because this is a best-effort preload: the
 * entry file itself does not require tsx, and failing here would be a
 * regression for environments where tsx is absent, incompatible, or
 * broken.  If a transitive JSX/TSX dependency is later encountered
 * without a loader, the caller's catch block produces a helpful error.
 */
async function tryRegisterTsx(): Promise<void> {
  try {
    const tsx = await import("tsx/esm/api");
    tsx.register();
  } catch {
    // Intentionally empty — see JSDoc above.
  }
}

/**
 * Checks if a value is a Program object.
 */
function isProgram(
  value: unknown,
): value is Program<Mode, unknown> {
  try {
    return (
      value != null &&
      typeof value === "object" &&
      "parser" in value &&
      "metadata" in value &&
      typeof (value as Program<Mode, unknown>).metadata === "object" &&
      (value as Program<Mode, unknown>).metadata != null &&
      typeof (value as Program<Mode, unknown>).metadata.name === "string" &&
      isParser((value as Program<Mode, unknown>).parser)
    );
  } catch {
    return false;
  }
}

/**
 * Checks if a value is a Parser object.
 */
function isParser(
  value: unknown,
): value is Parser<Mode, unknown, unknown> {
  try {
    return (
      value != null &&
      typeof value === "object" &&
      "parse" in value &&
      typeof (value as { parse?: unknown }).parse === "function" &&
      "$mode" in value &&
      "usage" in value &&
      "getDocFragments" in value &&
      typeof (value as { getDocFragments?: unknown }).getDocFragments ===
        "function"
    );
  } catch {
    return false;
  }
}

/**
 * Infers the program name from a file path.
 */
function inferNameFromPath(filePath: string): string {
  const base = basename(filePath);
  const ext = extname(base);
  return ext.length > 0 ? base.slice(0, -ext.length) : base;
}

/**
 * Gets available exports from a module.
 */
function getAvailableExports(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).filter((key) => key !== "__esModule");
}

/**
 * Describes the type of a value for error messages.
 */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Main CLI entry point.
 */
export async function main(): Promise<void> {
  const args = runSync(cliProgram, {
    help: "option",
    version: {
      value: denoJson.version,
      option: true,
    },
  });

  // Import the module
  const mod = await importModule(args.file);

  // Get the export
  const target = args.exportName === "default"
    ? mod.default
    : mod[args.exportName];

  if (target === undefined) {
    exportNotFoundError(
      args.file,
      args.exportName,
      getAvailableExports(mod),
    );
  }

  // Validate type
  if (!isProgram(target) && !isParser(target)) {
    notProgramOrParserError(
      args.file,
      args.exportName,
      describeType(target),
    );
  }

  // Determine the program name
  const name = args.name ??
    (isProgram(target) ? target.metadata.name : null) ??
    inferNameFromPath(args.file);

  // Generate man page
  const date = args.date ?? new Date();
  let manPage: string;
  try {
    if (isProgram(target)) {
      manPage = await generateManPageAsync(target, {
        section: args.section,
        name: args.name, // explicit override
        date,
        version: args.versionString,
        manual: args.manual,
      });
    } else {
      manPage = await generateManPageAsync(target, {
        name,
        section: args.section,
        date,
        version: args.versionString,
        manual: args.manual,
      });
    }
  } catch (error) {
    generationError(error instanceof Error ? error : new Error(String(error)));
  }

  // Output
  if (args.output) {
    try {
      await writeFile(args.output, manPage, "utf-8");
    } catch (error) {
      writeError(
        args.output,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  } else {
    // deno-lint-ignore no-console
    console.log(manPage);
  }
}

// Run main() when executed directly
// - Deno/Bun: import.meta.main
// - Node.js 22.18.0+/24.2.0+: import.meta.main
// - Older Node.js: compare process.argv[1] with import.meta.url
const isMain: boolean = "main" in import.meta
  ? import.meta.main
  : process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main();
