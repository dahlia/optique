import { type Message, message, text } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { existsSync, statSync } from "node:fs";
import { dirname, extname } from "node:path";

/**
 * Configuration options for the {@link path} value parser.
 */
export interface PathOptions {
  /**
   * The metavariable name for this parser, e.g., `"FILE"`, `"DIR"`.
   * @default "PATH"
   */
  readonly metavar?: string;

  /**
   * Whether the path must exist on the filesystem.
   * @default false
   */
  readonly mustExist?: boolean;

  /**
   * Expected type of path (file, directory, or either).
   * Only checked when {@link mustExist} is true.
   * @default "either"
   */
  readonly type?: "file" | "directory" | "either";

  /**
   * Whether to allow creating new files/directories.
   * When true and mustExist is false, validates that parent directory exists.
   * @default false
   */
  readonly allowCreate?: boolean;

  /**
   * File extensions to accept (for files only).  Each extension must
   * start with a dot (e.g. `".json"`, `".yaml"`).
   */
  readonly extensions?: readonly string[];

  /**
   * Custom error messages for path validation failures.
   * @since 0.5.0
   */
  readonly errors?: {
    /**
     * Custom error message when file extension is invalid.
     * Can be a static message or a function that receives input, expected extensions, and actual extension.
     * @since 0.5.0
     */
    invalidExtension?:
      | Message
      | ((
        input: string,
        extensions: readonly string[],
        actualExtension: string,
      ) => Message);

    /**
     * Custom error message when path does not exist.
     * Can be a static message or a function that receives the input path.
     * @since 0.5.0
     */
    pathNotFound?: Message | ((input: string) => Message);

    /**
     * Custom error message when path is expected to be a file but isn't.
     * Can be a static message or a function that receives the input path.
     * @since 0.5.0
     */
    notAFile?: Message | ((input: string) => Message);

    /**
     * Custom error message when path is expected to be a directory but isn't.
     * Can be a static message or a function that receives the input path.
     * @since 0.5.0
     */
    notADirectory?: Message | ((input: string) => Message);

    /**
     * Custom error message when parent directory does not exist for new files.
     * Can be a static message or a function that receives the parent directory path.
     * @since 0.5.0
     */
    parentNotFound?: Message | ((parentDir: string) => Message);
  };
}

/**
 * Creates a ValueParser for file system paths with validation options.
 *
 * This parser provides filesystem validation and type checking for command-line
 * path arguments. It can validate existence, file vs directory types, parent
 * directory existence for new files, and file extensions.
 *
 * @param options Configuration options for path validation.
 * @returns A ValueParser that validates and returns string paths.
 *
 * @example
 * ```typescript
 * import { path } from "@optique/run";
 * import { argument, object } from "@optique/core/parser";
 *
 * // Basic path parser (any path, no validation)
 * const configFile = argument(path());
 *
 * // File must exist
 * const inputFile = argument(path({ mustExist: true }));
 *
 * // Directory must exist
 * const outputDir = argument(path({ mustExist: true, type: "directory" }));
 *
 * // File can be created (parent directory must exist)
 * const logFile = argument(path({ type: "file", allowCreate: true }));
 *
 * // Config files with specific extensions
 * const config = argument(path({
 *   mustExist: true,
 *   type: "file",
 *   extensions: [".json", ".yaml", ".yml"]
 * }));
 * ```
 */
export function path(options: PathOptions = {}): ValueParser<string> {
  const {
    metavar = "PATH",
    mustExist = false,
    type = "either",
    allowCreate = false,
    extensions,
  } = options;

  return {
    metavar,
    parse(input: string): ValueParserResult<string> {
      // Extension validation
      if (extensions && extensions.length > 0) {
        const ext = extname(input);
        if (!extensions.includes(ext)) {
          const actualExt = ext || "no extension";
          return {
            success: false,
            error: options.errors?.invalidExtension
              ? (typeof options.errors.invalidExtension === "function"
                ? options.errors.invalidExtension(input, extensions, actualExt)
                : options.errors.invalidExtension)
              : message`Expected file with extension ${
                text(extensions.join(", "))
              }, got ${text(actualExt)}.`,
          };
        }
      }

      // Existence validation
      if (mustExist) {
        if (!existsSync(input)) {
          return {
            success: false,
            error: options.errors?.pathNotFound
              ? (typeof options.errors.pathNotFound === "function"
                ? options.errors.pathNotFound(input)
                : options.errors.pathNotFound)
              : message`Path ${text(input)} does not exist.`,
          };
        }

        // Type validation
        const stats = statSync(input);
        if (type === "file" && !stats.isFile()) {
          return {
            success: false,
            error: options.errors?.notAFile
              ? (typeof options.errors.notAFile === "function"
                ? options.errors.notAFile(input)
                : options.errors.notAFile)
              : message`Expected a file, but ${text(input)} is not a file.`,
          };
        }
        if (type === "directory" && !stats.isDirectory()) {
          return {
            success: false,
            error: options.errors?.notADirectory
              ? (typeof options.errors.notADirectory === "function"
                ? options.errors.notADirectory(input)
                : options.errors.notADirectory)
              : message`Expected a directory, but ${
                text(input)
              } is not a directory.`,
          };
        }
      }

      // Create validation (parent directory must exist)
      if (allowCreate && !mustExist) {
        const parentDir = dirname(input);
        if (!existsSync(parentDir)) {
          return {
            success: false,
            error: options.errors?.parentNotFound
              ? (typeof options.errors.parentNotFound === "function"
                ? options.errors.parentNotFound(parentDir)
                : options.errors.parentNotFound)
              : message`Parent directory ${text(parentDir)} does not exist.`,
          };
        }
      }

      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
  };
}
