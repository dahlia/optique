/**
 * @optique/git - Git value parsers for Optique
 *
 * This package provides async value parsers for validating Git references
 * (branches, tags, commits, remotes) using isomorphic-git.
 */
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Suggestion } from "@optique/core/parser";
import { type Message, message, value, valueSet } from "@optique/core/message";
import {
  ensureNonEmptyString,
  type NonEmptyString,
} from "@optique/core/nonempty";

import * as git from "isomorphic-git";
import * as fs from "node:fs/promises";
import process from "node:process";

export {
  expandOid,
  listBranches,
  listRemotes,
  listTags,
  readObject,
  resolveRef,
} from "isomorphic-git";

const gitFs = {
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  mkdir: fs.mkdir,
  rmdir: fs.rmdir,
  unlink: fs.unlink,
  readdir: fs.readdir,
  readlink: fs.readlink,
  symlink: fs.symlink,
  stat: fs.stat,
  lstat: fs.lstat,
};

/**
 * Options for creating git value parsers.
 *
 * @since 0.9.0
 */
export interface GitParserOptions {
  /**
   * The directory of the git repository.
   * Defaults to the current working directory.
   */
  dir?: string;

  /**
   * The metavar name for this parser.
   * Used in help messages to indicate what kind of value this parser expects.
   */
  metavar?: NonEmptyString;

  /**
   * Custom error messages for validation failures.
   *
   * @since 0.9.0
   */
  errors?: GitParserErrors;
}

/**
 * Custom error messages for git value parsers.
 *
 * @since 0.9.0
 */
export interface GitParserErrors {
  /**
   * Error message when the git reference (branch, tag, remote, commit) is not found.
   *
   * @param input The user-provided input that was not found.
   * @param available List of available references (if applicable).
   * @returns A custom error message.
   */
  notFound?: (input: string, available?: readonly string[]) => Message;

  /**
   * Error message when listing git references fails.
   * This typically occurs when the directory is not a valid git repository.
   *
   * @param dir The directory that was being accessed.
   * @returns A custom error message.
   */
  listFailed?: (dir: string) => Message;

  /**
   * Error message when the input format is invalid.
   * Applies to parsers that validate format (e.g., commit SHA).
   *
   * @param input The user-provided input that has invalid format.
   * @returns A custom error message.
   */
  invalidFormat?: (input: string) => Message;
}

/**
 * Git parsers factory interface.
 *
 * @since 0.9.0
 */
export interface GitParsers {
  /**
   * Creates a value parser that validates local branch names.
   * @param options Configuration options for the parser.
   * @returns A value parser that accepts existing branch names.
   */
  branch(options?: GitParserOptions): ValueParser<"async", string>;

  /**
   * Creates a value parser that validates remote branch names.
   * @param remote The remote name to validate against.
   * @param options Configuration options for the parser.
   * @returns A value parser that accepts existing remote branch names.
   */
  remoteBranch(
    remote: string,
    options?: GitParserOptions,
  ): ValueParser<"async", string>;

  /**
   * Creates a value parser that validates tag names.
   * @param options Configuration options for the parser.
   * @returns A value parser that accepts existing tag names.
   */
  tag(options?: GitParserOptions): ValueParser<"async", string>;

  /**
   * Creates a value parser that validates remote names.
   * @param options Configuration options for the parser.
   * @returns A value parser that accepts existing remote names.
   */
  remote(options?: GitParserOptions): ValueParser<"async", string>;

  /**
   * Creates a value parser that validates commit SHAs.
   * @param options Configuration options for the parser.
   * @returns A value parser that accepts existing commit SHAs.
   */
  commit(options?: GitParserOptions): ValueParser<"async", string>;

  /**
   * Creates a value parser that validates any git reference.
   * Accepts branch names, tag names, or commit SHAs.
   * @param options Configuration options for the parser.
   * @returns A value parser that accepts any git reference.
   */
  ref(options?: GitParserOptions): ValueParser<"async", string>;
}

interface GitRemote {
  remote: string;
  url: string;
}

const METAVAR_BRANCH: NonEmptyString = "BRANCH";
const METAVAR_TAG: NonEmptyString = "TAG";
const METAVAR_REMOTE: NonEmptyString = "REMOTE";

function getRepoDir(dirOption: string | undefined): string {
  if (dirOption != null) {
    return dirOption;
  }
  if (typeof process !== "undefined" && typeof process.cwd === "function") {
    return process.cwd();
  }
  throw new Error(
    "Git parser requires a `dir` option in environments where " +
      "`process.cwd()` is unavailable.",
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { readonly code?: unknown }).code === code;
}

function listFailureMessage(
  error: unknown,
  dir: string,
  errors: GitParserErrors | undefined,
  fallback: Message,
): Message {
  if (errors?.listFailed) {
    return errors.listFailed(dir);
  }

  if (
    hasErrorCode(error, "NotAGitRepositoryError") ||
    hasErrorCode(error, "NotFoundError")
  ) {
    return message`${value(dir)} is not a git repository.`;
  }

  return fallback;
}

function createAsyncValueParser(
  options: GitParserOptions | undefined,
  metavar: NonEmptyString,
  parseFn: (
    dir: string,
    input: string,
    errors: GitParserErrors | undefined,
  ) => Promise<ValueParserResult<string>>,
  suggestFn?: (
    dir: string,
    prefix: string,
  ) => AsyncIterable<Suggestion>,
): ValueParser<"async", string> {
  ensureNonEmptyString(metavar);

  return {
    $mode: "async",
    metavar,
    parse(input: string): Promise<ValueParserResult<string>> {
      const dir = getRepoDir(options?.dir);
      return parseFn(dir, input, options?.errors);
    },
    format(value: string): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      const dir = getRepoDir(options?.dir);
      if (suggestFn) {
        yield* suggestFn(dir, prefix);
      }
    },
  };
}

/**
 * Creates a value parser that validates local branch names.
 *
 * This parser uses isomorphic-git to verify that the provided input
 * matches an existing branch in the repository.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing branch names.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { gitBranch } from "@optique/git";
 * import { argument } from "@optique/core/primitives";
 *
 * const parser = argument(gitBranch());
 * ~~~~
 */
export function gitBranch(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? METAVAR_BRANCH;
  return createAsyncValueParser(
    options,
    metavar,
    async (dir, input, errors) => {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir });
        if (branches.includes(input)) {
          return { success: true, value: input };
        }
        if (errors?.notFound) {
          return { success: false, error: errors.notFound(input, branches) };
        }
        return {
          success: false,
          error: message`Branch ${
            value(input)
          } does not exist. Available branches: ${valueSet(branches)}`,
        };
      } catch (error) {
        const fallback = message`Failed to list branches. Ensure ${
          value(dir)
        } is a valid git repository.`;
        return {
          success: false,
          error: listFailureMessage(error, dir, errors, fallback),
        };
      }
    },
    async function* suggestBranch(dir, prefix) {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir });
        for (const branch of branches) {
          if (branch.startsWith(prefix)) {
            yield { kind: "literal" as const, text: branch };
          }
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a value parser that validates remote branch names.
 *
 * This parser uses isomorphic-git to verify that the provided input
 * matches an existing branch on the specified remote.
 *
 * @param remote The remote name to validate against.
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing remote branch names.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { gitRemoteBranch } from "@optique/git";
 * import { option } from "@optique/core/primitives";
 *
 * const parser = option("-b", "--branch", gitRemoteBranch("origin"));
 * ~~~~
 */
export function gitRemoteBranch(
  remote: string,
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? METAVAR_BRANCH;
  return createAsyncValueParser(
    options,
    metavar,
    async (dir, input, errors) => {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir, remote });
        if (branches.includes(input)) {
          return { success: true, value: input };
        }
        if (errors?.notFound) {
          return { success: false, error: errors.notFound(input, branches) };
        }
        return {
          success: false,
          error: message`Remote branch ${
            value(input)
          } does not exist on remote ${value(remote)}. Available branches: ${
            valueSet(branches)
          }`,
        };
      } catch (error) {
        const fallback =
          message`Failed to list remote branches. Ensure remote ${
            value(remote)
          } exists.`;

        return {
          success: false,
          error: listFailureMessage(error, dir, errors, fallback),
        };
      }
    },
    async function* suggestRemoteBranch(dir, prefix) {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir, remote });
        for (const branch of branches) {
          if (branch.startsWith(prefix)) {
            yield { kind: "literal" as const, text: branch };
          }
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a value parser that validates tag names.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing tag names.
 * @since 0.9.0
 */
export function gitTag(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? METAVAR_TAG;
  return createAsyncValueParser(
    options,
    metavar,
    async (dir, input, errors) => {
      try {
        const tags = await git.listTags({ fs: gitFs, dir });
        if (tags.includes(input)) {
          return { success: true, value: input };
        }
        if (errors?.notFound) {
          return { success: false, error: errors.notFound(input, tags) };
        }
        return {
          success: false,
          error: message`Tag ${value(input)} does not exist. Available tags: ${
            valueSet(tags)
          }`,
        };
      } catch (error) {
        const fallback = message`Failed to list tags. Ensure ${
          value(dir)
        } is a valid git repository.`;
        return {
          success: false,
          error: listFailureMessage(error, dir, errors, fallback),
        };
      }
    },
    async function* suggestTag(dir, prefix) {
      try {
        const tags = await git.listTags({ fs: gitFs, dir });
        for (const tag of tags) {
          if (tag.startsWith(prefix)) {
            yield { kind: "literal" as const, text: tag };
          }
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a value parser that validates remote names.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing remote names.
 * @since 0.9.0
 */
export function gitRemote(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? METAVAR_REMOTE;
  return createAsyncValueParser(
    options,
    metavar,
    async (dir, input, errors) => {
      try {
        const remotes = await git.listRemotes({ fs: gitFs, dir });
        const names = remotes.map((r: GitRemote) => r.remote);
        if (names.includes(input)) {
          return { success: true, value: input };
        }
        if (errors?.notFound) {
          return { success: false, error: errors.notFound(input, names) };
        }
        return {
          success: false,
          error: message`Remote ${
            value(input)
          } does not exist. Available remotes: ${valueSet(names)}`,
        };
      } catch (error) {
        const fallback = message`Failed to list remotes. Ensure ${
          value(dir)
        } is a valid git repository.`;
        return {
          success: false,
          error: listFailureMessage(error, dir, errors, fallback),
        };
      }
    },
    async function* suggestRemote(dir, prefix) {
      try {
        const remotes = await git.listRemotes({ fs: gitFs, dir });
        for (const r of remotes) {
          if (r.remote.startsWith(prefix)) {
            yield { kind: "literal" as const, text: r.remote };
          }
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a value parser that validates commit SHAs.
 *
 * This parser resolves the provided commit reference to its full 40-character
 * OID.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing commit SHAs.
 * @since 0.9.0
 */
export function gitCommit(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? "COMMIT";
  return createAsyncValueParser(
    options,
    metavar,
    async (dir, input, errors) => {
      try {
        ensureNonEmptyString(input);
      } catch {
        if (errors?.invalidFormat) {
          return { success: false, error: errors.invalidFormat(input) };
        }
        return {
          success: false,
          error: message`Invalid commit SHA: ${value(input)}`,
        };
      }

      if (input.length < 4 || input.length > 40) {
        if (errors?.invalidFormat) {
          return { success: false, error: errors.invalidFormat(input) };
        }
        return {
          success: false,
          error: message`Commit ${
            value(input)
          } must be between 4 and 40 characters.`,
        };
      }

      try {
        const oid = await git.expandOid({ fs: gitFs, dir, oid: input });
        return { success: true, value: oid };
      } catch {
        if (errors?.notFound) {
          return { success: false, error: errors.notFound(input) };
        }
        return {
          success: false,
          error: message`Commit ${
            value(input)
          } does not exist. Provide a valid commit SHA.`,
        };
      }
    },
    async function* suggestCommit(dir, prefix) {
      try {
        const commits = await git.log({ fs: gitFs, dir, depth: 15 });
        for (const commit of commits) {
          if (commit.oid.startsWith(prefix)) {
            const shortOid = commit.oid.slice(0, 7);
            const firstLine = commit.commit.message.split("\n")[0];
            yield {
              kind: "literal" as const,
              text: shortOid,
              description: message`${firstLine}`,
            };
          }
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a value parser that validates any git reference.
 *
 * Accepts branch names, tag names, or commit SHAs and resolves them to the
 * corresponding commit OID.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts any git reference.
 * @since 0.9.0
 */
export function gitRef(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? "REF";
  return createAsyncValueParser(
    options,
    metavar,
    async (dir, input, errors) => {
      try {
        const resolved = await git.resolveRef({ fs: gitFs, dir, ref: input });
        return { success: true, value: resolved };
      } catch {
        try {
          const oid = await git.expandOid({ fs: gitFs, dir, oid: input });
          return { success: true, value: oid };
        } catch {
          if (errors?.notFound) {
            return { success: false, error: errors.notFound(input) };
          }
          return {
            success: false,
            error: message`Reference ${
              value(input)
            } does not exist. Provide a valid branch, tag, or commit SHA.`,
          };
        }
      }
    },
    async function* suggestRef(dir, prefix) {
      try {
        const [branches, tags, commits] = await Promise.all([
          git.listBranches({ fs: gitFs, dir }),
          git.listTags({ fs: gitFs, dir }),
          git.log({ fs: gitFs, dir, depth: 10 }),
        ]);

        for (const branch of branches) {
          if (branch.startsWith(prefix)) {
            yield { kind: "literal" as const, text: branch };
          }
        }

        for (const tag of tags) {
          if (tag.startsWith(prefix)) {
            yield { kind: "literal" as const, text: tag };
          }
        }

        for (const commit of commits) {
          if (commit.oid.startsWith(prefix)) {
            const shortOid = commit.oid.slice(0, 7);
            const firstLine = commit.commit.message.split("\n")[0];
            yield {
              kind: "literal" as const,
              text: shortOid,
              description: message`${firstLine}`,
            };
          }
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a set of git parsers with shared configuration.
 *
 * @param options Shared configuration for the parsers.
 * @returns An object containing git parsers.
 * @since 0.9.0
 */
export function createGitParsers(options?: GitParserOptions): GitParsers {
  return {
    branch: (branchOptions?: GitParserOptions) =>
      gitBranch(branchOptions ?? options),
    remoteBranch: (remote: string, branchOptions?: GitParserOptions) =>
      gitRemoteBranch(remote, branchOptions ?? options),
    tag: (tagOptions?: GitParserOptions) => gitTag(tagOptions ?? options),
    remote: (remoteOptions?: GitParserOptions) =>
      gitRemote(remoteOptions ?? options),
    commit: (commitOptions?: GitParserOptions) =>
      gitCommit(commitOptions ?? options),
    ref: (refOptions?: GitParserOptions) => gitRef(refOptions ?? options),
  } satisfies GitParsers;
}
