@optique/git
============

Git reference parsers for Optique CLI parser.

This package provides async value parsers for validating Git references
(branches, tags, commits, remotes) using [isomorphic-git]. It allows CLI
tools to accept only valid Git references from user input.

[isomorphic-git]: https://github.com/isomorphic-git/isomorphic-git


Installation
------------

~~~~ bash
# Deno
deno add jsr:@optique/git

# npm
npm install @optique/git

# pnpm
pnpm add @optique/git
~~~~


Quick start
-----------

~~~~ typescript
import { gitBranch, gitTag, gitCommit } from "@optique/git";
import { argument, option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  branch: argument(gitBranch()),
  tag: option("-t", "--tag", gitTag()),
  commit: option("-c", "--commit", gitCommit()),
});

const result = await parseAsync(parser, ["feature/login"]);
// result.success === true
// result.value.branch === "feature/login"
~~~~


Custom repository location
--------------------------

By default, parsers use the current working directory as the Git repository.
Use `createGitParsers()` to create parsers for a different repository:

~~~~ typescript
import { createGitParsers } from "@optique/git";
import { argument, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const git = createGitParsers({ dir: "/path/to/repo" });

const parser = object({
  branch: argument(git.branch()),
  tag: option("-t", "--tag", git.tag()),
});

const result = await parseAsync(parser, ["v1.0.0"]);
// result.success === true
// result.value.tag === "v1.0.0"
~~~~


API
---

### `gitBranch(options?)`

A value parser for local branch names. Validates that the input matches an
existing branch in the repository.

~~~~ typescript
import { gitBranch } from "@optique/git";
import { argument, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  branch: argument(gitBranch()),
});

const result = await parseAsync(parser, ["main"]);
// Valid branch
~~~~

Options:

 -  `dir`: Git repository directory (defaults to current working directory)
 -  `metavar`: Metavar name for help text (default: `"BRANCH"`)


### `gitRemoteBranch(remote, options?)`

A value parser for remote branch names. Validates that the input matches an
existing branch on the specified remote.

~~~~ typescript
import { gitRemoteBranch } from "@optique/git";
import { option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  branch: option("-b", "--branch", gitRemoteBranch("origin")),
});

const result = await parseAsync(parser, ["--branch=main"]);
// Valid remote branch on origin
~~~~


### `gitTag(options?)`

A value parser for tag names. Validates that the input matches an existing tag
in the repository.

~~~~ typescript
import { gitTag } from "@optique/git";
import { option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  tag: option("-t", "--tag", gitTag()),
});

const result = await parseAsync(parser, ["--tag=v1.0.0"]);
// Valid tag
~~~~


### `gitRemote(options?)`

A value parser for remote names. Validates that the input matches an existing
remote in the repository.

~~~~ typescript
import { gitRemote } from "@optique/git";
import { option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  remote: option("-r", "--remote", gitRemote()),
});

const result = await parseAsync(parser, ["--remote=origin"]);
// Valid remote
~~~~


### `gitCommit(options?)`

A value parser for commit SHAs. Validates that the input is a valid commit SHA
(full or shortened) that exists in the repository.

~~~~ typescript
import { gitCommit } from "@optique/git";
import { option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  commit: option("-c", "--commit", gitCommit()),
});

const result = await parseAsync(parser, ["--commit=abc1234"]);
// Valid commit SHA
~~~~


### `gitRef(options?)`

A value parser for any Git reference (branches, tags, or commits). Validates
that the input resolves to a valid Git reference.

~~~~ typescript
import { gitRef } from "@optique/git";
import { option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const parser = object({
  ref: option("--ref", gitRef()),
});

const result = await parseAsync(parser, ["--ref=v1.0.0"]);
// Valid branch, tag, or commit
~~~~


### `createGitParsers(options?)`

Creates a factory for Git parsers with shared configuration. All parsers
created by the factory share the same filesystem and directory options.

~~~~ typescript
import { createGitParsers } from "@optique/git";
import { argument, option, object } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const git = createGitParsers({ dir: "/path/to/repo" });

const parser = object({
  branch: argument(git.branch()),
  tag: option("-t", "--tag", git.tag()),
  commit: option("-c", "--commit", git.commit()),
  ref: option("--ref", git.ref()),
});
~~~~

The factory returns a `GitParsers` object with the following methods:

 -  `branch(options?)` - Same as `gitBranch()`
 -  `remoteBranch(remote, options?)` - Same as `gitRemoteBranch()`
 -  `tag(options?)` - Same as `gitTag()`
 -  `remote(options?)` - Same as `gitRemote()`
 -  `commit(options?)` - Same as `gitCommit()`
 -  `ref(options?)` - Same as `gitRef()`


Shell completion
----------------

All Git parsers support automatic shell completion. The parsers provide
suggestions for existing branches, tags, remotes, and commits that match
the user's input prefix.

~~~~ typescript
import { gitBranch } from "@optique/git";
import { argument, object } from "@optique/core/primitives";

const parser = object({
  branch: argument(gitBranch()),
});
// Shell completion will suggest matching branch names
~~~~


License
-------

Distributed under the MIT License. See the *LICENSE* file for details.
