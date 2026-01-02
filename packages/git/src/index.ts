/**
 * @optique/git - Git value parsers for Optique
 *
 * This package provides async value parsers for validating Git references
 * (branches, tags, commits, remotes) using isomorphic-git.
 */
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Suggestion } from "@optique/core/parser";
import { message, text } from "@optique/core/message";
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
const _METAVAR_VALUE: NonEmptyString = "VALUE";

function getRepoDir(dirOption: string | undefined): string {
  return dirOption ?? (typeof process !== "undefined" ? process.cwd() : ".");
}

function createAsyncValueParser(
  options: GitParserOptions | undefined,
  metavar: NonEmptyString,
  parseFn: (
    dir: string,
    input: string,
  ) => Promise<ValueParserResult<string>>,
  suggestFn?: (
    dir: string,
    prefix: string,
  ) => AsyncIterable<Suggestion>,
): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar,
    parse(input: string): Promise<ValueParserResult<string>> {
      const dir = getRepoDir(options?.dir);
      ensureNonEmptyString(metavar);
      return parseFn(dir, input);
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
    async (dir, input) => {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir });
        if (branches.includes(input)) {
          return { success: true, value: input };
        }
        return {
          success: false,
          error: message`Branch ${
            text(input)
          } does not exist. Available branches: ${branches.join(", ")}`,
        };
      } catch {
        return {
          success: false,
          error: message`Failed to list branches. Ensure ${
            text(dir)
          } is a valid git repository.`,
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
    async (dir, input) => {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir, remote });
        if (branches.includes(input)) {
          return { success: true, value: input };
        }
        return {
          success: false,
          error: message`Remote branch ${
            text(input)
          } does not exist on remote ${text(remote)}. Available branches: ${
            branches.join(", ")
          }`,
        };
      } catch {
        return {
          success: false,
          error: message`Failed to list remote branches. Ensure remote ${
            text(remote)
          } exists.`,
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
    async (dir, input) => {
      try {
        const tags = await git.listTags({ fs: gitFs, dir });
        if (tags.includes(input)) {
          return { success: true, value: input };
        }
        return {
          success: false,
          error: message`Tag ${text(input)} does not exist. Available tags: ${
            tags.join(", ")
          }`,
        };
      } catch {
        return {
          success: false,
          error: message`Failed to list tags. Ensure ${
            text(dir)
          } is a valid git repository.`,
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
    async (dir, input) => {
      try {
        const remotes = await git.listRemotes({ fs: gitFs, dir });
        const names = remotes.map((r: GitRemote) => r.remote);
        if (names.includes(input)) {
          return { success: true, value: input };
        }
        return {
          success: false,
          error: message`Remote ${
            text(input)
          } does not exist. Available remotes: ${names.join(", ")}`,
        };
      } catch {
        return {
          success: false,
          error: message`Failed to list remotes. Ensure ${
            text(dir)
          } is a valid git repository.`,
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
    async (dir, input) => {
      try {
        ensureNonEmptyString(input);
      } catch {
        return {
          success: false,
          error: message`Invalid commit SHA: ${text(input)}`,
        };
      }

      if (input.length < 4 || input.length > 40) {
        return {
          success: false,
          error: message`Commit ${
            text(input)
          } must be between 4 and 40 characters.`,
        };
      }

      try {
        const oid = await git.expandOid({ fs: gitFs, dir, oid: input });
        return { success: true, value: oid };
      } catch {
        return {
          success: false,
          error: message`Commit ${
            text(input)
          } does not exist. Provide a valid commit SHA.`,
        };
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
    async (dir, input) => {
      try {
        const resolved = await git.resolveRef({ fs: gitFs, dir, ref: input });
        return { success: true, value: resolved };
      } catch {
        try {
          const oid = await git.expandOid({ fs: gitFs, dir, oid: input });
          return { success: true, value: oid };
        } catch {
          return {
            success: false,
            error: message`Reference ${
              text(input)
            } does not exist. Provide a valid branch, tag, or commit SHA.`,
          };
        }
      }
    },
    async function* suggestRef(dir, prefix) {
      try {
        const branches = await git.listBranches({ fs: gitFs, dir });
        const tags = await git.listTags({ fs: gitFs, dir });

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
