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
import process from "node:process";

export {
  expandOid,
  listBranches,
  listRemotes,
  listTags,
  readObject,
  resolveRef,
} from "isomorphic-git";

/**
 * Interface for FileSystem operations required by git parsers.
 * This allows custom filesystem implementations for different environments.
 *
 * @since 0.9.0
 */
export interface FileSystem {
  readFile(path: string): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  lstat(
    path: string,
  ): Promise<
    { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }
  >;
  stat(
    path: string,
  ): Promise<
    { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }
  >;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  chown(path: string, uid: number, gid: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(srcPath: string, destPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Options for creating git value parsers.
 *
 * @since 0.9.0
 */
export interface GitParserOptions {
  /**
   * The filesystem implementation to use.
   * Defaults to node:fs/promises (works in Deno and Node.js).
   */
  fs?: FileSystem;

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
  branch(options?: GitParserOptions): ValueParser<"async", string>;
  remoteBranch(
    remote: string,
    options?: GitParserOptions,
  ): ValueParser<"async", string>;
  tag(options?: GitParserOptions): ValueParser<"async", string>;
  remote(options?: GitParserOptions): ValueParser<"async", string>;
  commit(options?: GitParserOptions): ValueParser<"async", string>;
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

let defaultFs: FileSystem | null = null;
let fsLoading: Promise<FileSystem> | null = null;

async function getDefaultFs(): Promise<FileSystem> {
  if (defaultFs) return await defaultFs;
  if (fsLoading) return await fsLoading;

  fsLoading = (async () => {
    const nodeFs = await import("node:fs/promises");
    const { TextDecoder } = await import("node:util");
    const decoder = new TextDecoder();
    defaultFs = {
      async readFile(path) {
        const data = await nodeFs.readFile(path);
        if (path.endsWith("/index") || path.endsWith(".idx")) {
          return data;
        }
        return decoder.decode(data);
      },
      async writeFile(path, data) {
        await nodeFs.writeFile(path, data);
      },
      async mkdir(path, options) {
        await nodeFs.mkdir(path, options);
      },
      async rmdir(path, options) {
        await nodeFs.rmdir(path, options);
      },
      async unlink(path) {
        await nodeFs.unlink(path);
      },
      async readdir(path) {
        const entries = await nodeFs.readdir(path, { withFileTypes: false });
        return entries.filter((e): e is string => typeof e === "string");
      },
      async lstat(path) {
        return await nodeFs.lstat(path);
      },
      async stat(path) {
        return await nodeFs.stat(path);
      },
      async readlink(path) {
        return await nodeFs.readlink(path);
      },
      async symlink(target, path) {
        await nodeFs.symlink(target, path, "file");
      },
      async chmod(path, mode) {
        await nodeFs.chmod(path, mode);
      },
      async chown(path, uid, gid) {
        await nodeFs.chown(path, uid, gid);
      },
      async rename(oldPath, newPath) {
        await nodeFs.rename(oldPath, newPath);
      },
      async copyFile(srcPath, destPath) {
        await nodeFs.copyFile(srcPath, destPath);
      },
      async exists(path) {
        try {
          await nodeFs.stat(path);
          return true;
        } catch {
          return false;
        }
      },
    };
    return defaultFs;
  })();

  return fsLoading;
}

function createAsyncValueParser(
  options: GitParserOptions | undefined,
  metavar: NonEmptyString,
  parseFn: (
    fs: FileSystem,
    dir: string,
    input: string,
  ) => Promise<ValueParserResult<string>>,
  suggestFn?: (
    fs: FileSystem,
    dir: string,
    prefix: string,
  ) => AsyncIterable<Suggestion>,
): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar,
    async parse(input: string): Promise<ValueParserResult<string>> {
      const fs = options?.fs ?? await getDefaultFs();
      const dir = options?.dir ??
        (typeof process !== "undefined" ? process.cwd() : ".");
      ensureNonEmptyString(metavar);
      return parseFn(fs, dir, input);
    },
    format(value: string): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      const fs = options?.fs ?? await getDefaultFs();
      const dir = options?.dir ??
        (typeof process !== "undefined" ? process.cwd() : ".");
      if (suggestFn) {
        yield* suggestFn(fs, dir, prefix);
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
    async (fs, dir, input) => {
      try {
        const branches = await git.listBranches({ fs, dir });
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
    async function* suggestBranch(fs, dir, prefix) {
      try {
        const branches = await git.listBranches({ fs, dir });
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
    async (fs, dir, input) => {
      try {
        const branches = await git.listBranches({ fs, dir, remote });
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
    async function* suggestRemoteBranch(fs, dir, prefix) {
      try {
        const branches = await git.listBranches({ fs, dir, remote });
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
 * This parser uses isomorphic-git to verify that the provided input
 * matches an existing tag in the repository.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing tag names.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { gitTag } from "@optique/git";
 * import { option } from "@optique/core/primitives";
 *
 * const parser = option("-t", "--tag", gitTag());
 * ~~~~
 */
export function gitTag(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  const metavar: NonEmptyString = options?.metavar ?? METAVAR_TAG;
  return createAsyncValueParser(
    options,
    metavar,
    async (fs, dir, input) => {
      try {
        const tags = await git.listTags({ fs, dir });
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
    async function* suggestTag(fs, dir, prefix) {
      try {
        const tags = await git.listTags({ fs, dir });
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
 * This parser uses isomorphic-git to verify that the provided input
 * matches an existing remote in the repository.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts existing remote names.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { gitRemote } from "@optique/git";
 * import { option } from "@optique/core/primitives";
 *
 * const parser = option("-r", "--remote", gitRemote());
 * ~~~~
 */
export function gitRemote(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  return createAsyncValueParser(
    options,
    METAVAR_REMOTE,
    async (fs, dir, input) => {
      try {
        const remotes = await git.listRemotes({ fs, dir });
        const remoteNames: string[] = [];
        for (const r of remotes) {
          if ("remote" in r && typeof r.remote === "string") {
            remoteNames.push(r.remote);
          }
        }
        if (remoteNames.includes(input)) {
          return { success: true, value: input };
        }
        return {
          success: false,
          error: message`Remote ${
            text(input)
          } does not exist. Available remotes: ${remoteNames.join(", ")}`,
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
    async function* suggestRemote(fs, dir, prefix) {
      try {
        const remotes = await git.listRemotes({ fs, dir });
        for (const r of remotes) {
          if (
            "remote" in r && typeof r.remote === "string" &&
            r.remote.startsWith(prefix)
          ) {
            yield { kind: "literal", text: r.remote };
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
 * This parser uses isomorphic-git to verify that the provided input
 * is a valid commit SHA (full or shortened) that exists in the repository.
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts valid commit SHAs.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { gitCommit } from "@optique/git";
 * import { option } from "@optique/core/primitives";
 *
 * const parser = option("-c", "--commit", gitCommit());
 * ~~~~
 */
export function gitCommit(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  return createAsyncValueParser(
    options,
    "COMMIT",
    async (fs, dir, input) => {
      try {
        const oid = await git.expandOid({ fs, dir, oid: input });
        await git.readObject({ fs, dir, oid: oid });
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
    async function* suggestCommit(fs, dir, prefix) {
      try {
        const branches = await git.listBranches({ fs, dir });
        const commits: string[] = [];
        for (const branch of branches.slice(0, 10)) {
          try {
            const oid = await git.resolveRef({ fs, dir, ref: branch });
            if (oid.startsWith(prefix)) {
              commits.push(oid);
            }
          } catch {
            // Skip branches that can't be resolved
          }
        }
        for (const commit of [...new Set(commits)].slice(0, 10)) {
          yield { kind: "literal" as const, text: commit };
        }
      } catch {
        // Silently fail for suggestions
      }
    },
  );
}

/**
 * Creates a value parser that validates any git reference
 * (branches, tags, or commits).
 *
 * This parser uses isomorphic-git to verify that the provided input
 * resolves to a valid git reference (branch, tag, or commit SHA).
 *
 * @param options Configuration options for the parser.
 * @returns A value parser that accepts branches, tags, or commit SHAs.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { gitRef } from "@optique/git";
 * import { option } from "@optique/core/primitives";
 *
 * const parser = option("--ref", gitRef());
 * ~~~~
 */
export function gitRef(
  options?: GitParserOptions,
): ValueParser<"async", string> {
  return createAsyncValueParser(
    options,
    "REF",
    async (fs, dir, input) => {
      try {
        const oid = await git.resolveRef({ fs, dir, ref: input });
        return { success: true, value: oid };
      } catch {
        return {
          success: false,
          error: message`Reference ${
            text(input)
          } does not exist. Provide a valid branch, tag, or commit SHA.`,
        };
      }
    },
    async function* suggestRef(fs, dir, prefix) {
      try {
        const branches = await git.listBranches({ fs, dir });
        for (const branch of branches) {
          if (branch.startsWith(prefix)) {
            yield { kind: "literal" as const, text: branch };
          }
        }
        const tags = await git.listTags({ fs, dir });
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
 * Creates a factory for git parsers with shared configuration.
 *
 * This function returns an object with methods for creating individual git
 * parsers that share the same configuration (filesystem and directory).
 *
 * @param options Shared configuration options for all parsers.
 * @returns An object with methods for creating individual git parsers.
 * @since 0.9.0
 *
 * @example
 * ~~~~ typescript
 * import { createGitParsers } from "@optique/git";
 *
 * const git = createGitParsers({ dir: "/path/to/repo" });
 *
 * const branchParser = git.branch();
 * const tagParser = git.tag();
 * ~~~~
 */
export function createGitParsers(options?: GitParserOptions): GitParsers {
  return {
    branch: (parserOptions?: GitParserOptions) =>
      gitBranch({ ...options, ...parserOptions }),

    remoteBranch: (remote: string, parserOptions?: GitParserOptions) =>
      gitRemoteBranch(remote, { ...options, ...parserOptions }),

    tag: (parserOptions?: GitParserOptions) =>
      gitTag({ ...options, ...parserOptions }),

    remote: (parserOptions?: GitParserOptions) =>
      gitRemote({ ...options, ...parserOptions }),

    commit: (parserOptions?: GitParserOptions) =>
      gitCommit({ ...options, ...parserOptions }),

    ref: (parserOptions?: GitParserOptions) =>
      gitRef({ ...options, ...parserOptions }),
  };
}
