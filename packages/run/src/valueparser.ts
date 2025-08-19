import { message, text } from "@optique/core/message";
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
          return {
            success: false,
            error: message`Expected file with extension ${
              text(extensions.join(", "))
            }, got ${text(ext || "no extension")}.`,
          };
        }
      }

      // Existence validation
      if (mustExist) {
        if (!existsSync(input)) {
          return {
            success: false,
            error: message`Path ${text(input)} does not exist.`,
          };
        }

        // Type validation
        const stats = statSync(input);
        if (type === "file" && !stats.isFile()) {
          return {
            success: false,
            error: message`Expected a file, but ${text(input)} is not a file.`,
          };
        }
        if (type === "directory" && !stats.isDirectory()) {
          return {
            success: false,
            error: message`Expected a directory, but ${
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
            error: message`Parent directory ${text(parentDir)} does not exist.`,
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
