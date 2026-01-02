---
description: >-
  Git value parsers for validating branches, tags, commits, and remotes
  using isomorphic-git.
---

Git integration
===============

The `@optique/git` package provides async value parsers for validating Git
references (branches, tags, commits, remotes) using [isomorphic-git]. These
parsers validate input against an actual Git repository, ensuring that users
can only specify existing references.

~~~~ typescript twoslash
import { gitBranch, gitTag, gitCommit, gitRef, gitRemote, gitRemoteBranch } from "@optique/git";
import { option, argument } from "@optique/core/primitives";
~~~~

[isomorphic-git]: https://isomorphic-git.org/


Installation
------------

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/git
~~~~

~~~~ bash [npm]
npm add @optique/git
~~~~

~~~~ bash [pnpm]
pnpm add @optique/git
~~~~

~~~~ bash [Yarn]
yarn add @optique/git
~~~~

~~~~ bash [Bun]
bun add @optique/git
~~~~

:::


Getting started
---------------

Import the parsers from `@optique/git` and use them with Optique primitives:

~~~~ typescript twoslash
import { gitBranch } from "@optique/git";
import { argument } from "@optique/core/primitives";

const parser = argument(gitBranch());
// Accepts: "main", "develop", "feature/my-feature"
// Rejects: "nonexistent-branch"
~~~~


`gitBranch()`
-------------

Validates that input matches an existing local branch name in the repository.

~~~~ typescript twoslash
import { gitBranch } from "@optique/git";
import { argument } from "@optique/core/primitives";

const branchParser = argument(gitBranch());
~~~~

### Options

~~~~ typescript twoslash
import type { FileSystem, GitParserOptions } from "@optique/git";
~~~~

### Example

~~~~ typescript twoslash
import { gitBranch } from "@optique/git";
import { option } from "@optique/core/primitives";

// Branch argument for git checkout-like command
const checkoutParser = option("-b", "--branch", gitBranch());
// Usage: myapp checkout --branch feature/my-feature
~~~~


`gitTag()`
----------

Validates that input matches an existing tag name in the repository.

~~~~ typescript twoslash
import { gitTag } from "@optique/git";
import { option } from "@optique/core/primitives";

const tagParser = option("-t", "--tag", gitTag());
// Usage: myapp release --tag v1.0.0
~~~~

### Example with custom options

~~~~ typescript twoslash
import { gitTag } from "@optique/git";
import { option } from "@optique/core/primitives";
// @errors: 2345
// ---cut-before---
const versionParser = option("--release", gitTag({
  metavar: "VERSION" as "VERSION",
}));
~~~~


`gitRemote()`
-------------

Validates that input matches an existing remote name in the repository.

~~~~ typescript twoslash
import { gitRemote } from "@optique/git";
import { option } from "@optique/core/primitives";

const remoteParser = option("--remote", gitRemote());
// Usage: myapp fetch --remote origin
~~~~


`gitRemoteBranch()`
-------------------

Validates that input matches an existing branch on a specific remote.

~~~~ typescript twoslash
import { gitRemoteBranch } from "@optique/git";
import { option } from "@optique/core/primitives";

const remoteBranchParser = option("--branch", gitRemoteBranch("origin"));
// Usage: myapp pull --branch main
~~~~


`gitCommit()`
-------------

Validates that input is a valid commit SHA (full or shortened) that exists
in the repository. Returns the resolved full OID.

~~~~ typescript twoslash
import { gitCommit } from "@optique/git";
import { option } from "@optique/core/primitives";

const commitParser = option("--commit", gitCommit());
// Usage: myapp revert --commit abc1234
~~~~

### SHA formats supported

The parser accepts various SHA formats:

 -  Full 40-character SHA: `550e8400-e29b-41d4-a716-446655440000`
 -  Shortened SHAs (7+ characters): `550e840`, `550e8400e29b`

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { gitCommit } from "@optique/git";
import { option } from "@optique/core/primitives";

const parser = option("-c", "--commit", gitCommit());
// ---cut-before---
const result = await parseAsync(parser, ["-c", "550e840"]);
if (result.success) {
  console.log(result.value); // Full 40-char OID
}
~~~~


`gitRef()`
----------

A flexible parser that accepts any valid Git reference: branches, tags, or
commits. Returns the resolved commit OID.

~~~~ typescript twoslash
import { gitRef } from "@optique/git";
import { argument } from "@optique/core/primitives";

const refParser = argument(gitRef());
// Accepts: branch names, tags, or commit SHAs
// Returns: resolved commit OID
~~~~


`createGitParsers()`
--------------------

A factory function for creating multiple Git parsers with shared configuration.

~~~~ typescript twoslash
import { createGitParsers } from "@optique/git";
import { option } from "@optique/core/primitives";

const git = createGitParsers({
  dir: "/path/to/repo",
});

const parser = option("--branch", git.branch());
const tagParser = option("--tag", git.tag());
const commitParser = option("--commit", git.commit());
~~~~

### Example with custom options per parser

~~~~ typescript twoslash
import { createGitParsers } from "@optique/git";
// @errors: 2345
// ---cut-before---
const git = createGitParsers({
  dir: "/path/to/repo",
  metavar: "REF" as "REF",
});

// Override metavar for specific parser
const branchParser = git.branch({ metavar: "BRANCH_NAME" as "BRANCH_NAME" });
~~~~


Async mode
----------

All Git parsers operate in async mode because they perform I/O operations
to read the Git repository:

~~~~ typescript twoslash
import { gitBranch } from "@optique/git";
import { argument } from "@optique/core/primitives";

const parser = argument(gitBranch());
// parser.$mode === "async"
~~~~

Use `parseAsync()` with async parsers:

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { gitBranch } from "@optique/git";
import { argument } from "@optique/core/primitives";

const parser = argument(gitBranch());
// ---cut-before---
const result = await parseAsync(parser, ["main"]);
if (result.success) {
  console.log(result.value); // "main"
}
~~~~


Suggestions
-----------

Git parsers provide intelligent completion suggestions:

~~~~ typescript twoslash
import { gitBranch, gitTag, gitRef } from "@optique/git";
import { argument } from "@optique/core/primitives";

// Suggests existing branches
const branchParser = argument(gitBranch());
// Completing "fe" suggests: "feature/*", "fix/*", etc.

// Suggests existing tags
const tagParser = argument(gitTag());
// Completing "v1" suggests: "v1.0.0", "v1.1.0", etc.

// Suggests both branches and tags
const refParser = argument(gitRef());
// Completing "v" suggests tags; completing "fe" suggests branches
~~~~


Custom `FileSystem`
-------------------

The parsers accept a custom `FileSystem` implementation for different
environments. This is useful for testing or accessing repositories over HTTP.

~~~~ typescript
interface FileSystem {
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
~~~~

### Example usage

~~~~ typescript
import { gitBranch } from "@optique/git";

const customFs: FileSystem = {
  async readFile(path) { return ""; },
  async writeFile(path, data) { },
  async mkdir(path, options) { },
  async rmdir(path, options) { },
  async unlink(path) { },
  async readdir(path) { return []; },
  async lstat(path) {
    return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
  },
  async stat(path) {
    return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true };
  },
  async readlink(path) { return path; },
  async symlink(target, path) { },
  async chmod(path, mode) { },
  async chown(path, uid, gid) { },
  async rename(oldPath, newPath) { },
  async copyFile(srcPath, destPath) { },
  async exists(path) { return true; },
};

const parser = gitBranch({ fs: customFs });
~~~~


Error handling
--------------

Git parsers provide clear error messages:

~~~~ bash
$ myapp --branch nonexistent
Error: Branch nonexistent does not exist. Available branches: main, develop, feature/*.

$ myapp --tag v999.0.0
Error: Tag v999.0.0 does not exist. Available tags: v1.0.0, v2.0.0.

$ myapp --commit abc
Error: Commit abc does not exist. Provide a valid commit SHA.

$ myapp --ref nonexistent-ref
Error: Reference nonexistent-ref does not exist. Provide a valid branch, tag, or commit SHA.
~~~~


Metavar defaults
----------------

Each parser uses an appropriate default metavar for help text:

| Parser | Default Metavar |
|--------|----------------|
| `gitBranch()` | `"BRANCH"` |
| `gitTag()` | `"TAG"` |
| `gitRemote()` | `"REMOTE"` |
| `gitRemoteBranch()` | `"BRANCH"` |
| `gitCommit()` | `"COMMIT"` |
| `gitRef()` | `"REF"` |

Override with the `metavar` option:

~~~~ typescript twoslash
import { gitBranch, gitTag } from "@optique/git";
// @errors: 2345
// ---cut-before---
const branchParser = gitBranch({ metavar: "BRANCH_NAME" as "BRANCH_NAME" });
const tagParser = gitTag({ metavar: "RELEASE_VERSION" as "RELEASE_VERSION" });
~~~~


Exported utilities
------------------

The package also re-exports several utilities from isomorphic-git for
advanced use cases:

~~~~ typescript twoslash
import { expandOid, listBranches, listTags, listRemotes, readObject, resolveRef } from "@optique/git";
~~~~

- `expandOid()` - Expand short SHAs to full OIDs
- `listBranches()` - List all local branches
- `listTags()` - List all tags
- `listRemotes()` - List all remotes
- `readObject()` - Read a Git object
- `resolveRef()` - Resolve a ref to its OID


Complete example
----------------

A git-like CLI application using Git parsers:

~~~~ typescript twoslash
// @errors: 2304 2345 2339
import { createGitParsers } from "@optique/git";
import { command, argument, option, parseAsync } from "@optique/core";

const git = createGitParsers();

const checkoutCmd = command("checkout", () => ({
  branch: option("-b", "--branch", git.branch()),
  startPoint: argument(git.ref()),
}));

const logCmd = command("log", () => ({
  commit: option("-c", "--commit", git.commit()),
  maxCount: option("--max-count", git.tag()),
}));

const app = command("git", () => ({
  subcommand: checkoutCmd.or(logCmd),
}));
// ---cut-before---
const result = await parseAsync(app, ["checkout", "--branch", "develop", "main"]);
if (result.success) {
  console.log(result.value);
}
~~~~
