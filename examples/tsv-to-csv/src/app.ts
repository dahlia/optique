import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { argument, option } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import { path } from "@optique/run/valueparser";
import manifest from "../package.json" with { type: "json" };
import { deriveOutputPath, tsvToCsv } from "./convert.ts";

/**
 * The command-line program.  Parsing only validates arguments; it never
 * reads the input contents, writes the output, or asks a question.
 */
export const program = defineProgram({
  parser: object({
    input: argument(
      path({ metavar: "INPUT", mustExist: true, type: "file" }),
      { description: message`Tab-separated file to convert.` },
    ),
    output: optional(option(
      "-o",
      "--output",
      path({ metavar: "OUTPUT", type: "file", allowCreate: true }),
      {
        description: message`CSV file to write; defaults to INPUT with .csv.`,
      },
    )),
    force: option("-f", "--force", {
      description: message`Replace OUTPUT if it already exists.`,
    }),
  }),
  metadata: {
    name: "tsv-to-csv",
    version: manifest.version,
    brief: message`Convert a tab-separated file to CSV.`,
  },
});

/** The parsed command-line options. */
export interface ConvertOptions {
  readonly input: string;
  readonly output?: string;
  readonly force: boolean;
}

/** Process-facing effects, injected so tests can observe them. */
export interface ConvertIo {
  /** Writes one line of normal output. */
  readonly stdout: (line: string) => void;
  /** Writes one line of diagnostic output. */
  readonly stderr: (line: string) => void;
  /**
   * Asks whether to replace an existing destination.  Omit it when no
   * interactive terminal is available; the destination is then kept.
   */
  readonly confirm?: (output: string) => Promise<boolean>;
}

/**
 * Converts the input file and writes the result according to the overwrite
 * policy: refuse an existing destination, replace it with `force`, or ask
 * through `io.confirm` immediately before replacing it.
 *
 * @param options The parsed command-line options.
 * @param io Output writers and the optional confirmation prompt.
 * @returns The process exit code.
 */
export async function convertFile(
  options: ConvertOptions,
  io: ConvertIo,
): Promise<number> {
  const output = options.output ?? deriveOutputPath(options.input);
  try {
    const csv = tsvToCsv(await readFile(options.input, "utf8"));
    if (await createFile(output, csv)) {
      io.stdout(output);
      return 0;
    }
    if (!await isRegularFileOrMissing(output)) {
      io.stderr(`tsv-to-csv: ${output} is not a regular file.`);
      return 1;
    }
    if (await isSameFile(options.input, output)) {
      io.stderr(
        `tsv-to-csv: ${output} is the input file; choose another output.`,
      );
      return 1;
    }
    if (!options.force) {
      if (io.confirm == null) {
        io.stderr(
          `tsv-to-csv: ${output} already exists; use --force to replace it.`,
        );
        return 1;
      }
      if (!await io.confirm(output)) {
        io.stderr(`tsv-to-csv: Kept the existing ${output}.`);
        return 1;
      }
    }
    await replaceFile(output, csv);
  } catch (error) {
    io.stderr(
      `tsv-to-csv: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  io.stdout(output);
  return 0;
}

/**
 * Creates a file with the given contents only if nothing exists at that path.
 * The "wx" flag makes the existence check and the creation one filesystem
 * operation.  If writing fails after the file was created, the partial file
 * is removed, so a failed run does not leave a destination that the next run
 * would refuse to replace.
 *
 * @returns `true` if the file was created, or `false` if the path exists.
 */
async function createFile(path: string, contents: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) return false;
    throw error;
  }
  try {
    await handle.writeFile(contents);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(path, { force: true });
    throw error;
  }
  return true;
}

/**
 * Replaces the directory entry at `path` with a new file.  The contents are
 * written to a temporary file next to it, then renamed over the destination.
 * Renaming replaces the entry itself, so other hard links to the old file and
 * the target of a symbolic link stay unchanged, and a path swapped for a link
 * to some other file after the checks cannot redirect the write into it.
 */
async function replaceFile(path: string, contents: string): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  if (!await createFile(temporary, contents)) {
    throw new Error(`Temporary file already exists: ${temporary}`);
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Checks that an existing path is a regular file (following symbolic links),
 * so a directory, FIFO, or device is never replaced.  A dangling symbolic
 * link counts as missing.
 */
async function isRegularFileOrMissing(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return true;
    throw error;
  }
}

/**
 * Checks whether two paths currently name the same file by comparing device
 * and inode numbers.  This catches different spellings, symbolic links, and
 * hard links, but it is a snapshot: it cannot stop another process from
 * changing either path afterward.
 */
async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [first, second] = await Promise.all([
      stat(a, { bigint: true }),
      stat(b, { bigint: true }),
    ]);
    return first.dev === second.dev && first.ino === second.ino;
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
