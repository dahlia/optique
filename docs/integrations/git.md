---
description: >-
  Git value parsers for validating branches, tags, commits, and remotes
  using isomorphic-git.
---

Git integration
===============

The *@optique/git* package provides async value parsers for validating Git
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
import type { GitParserOptions } from "@optique/git";
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

const versionParser = option("--release", gitTag({
  metavar: "VERSION",
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

### Dynamic remote with dependencies

Use the [dependency system](../concepts/dependencies.md) to validate branches
against a user-specified remote. The `gitRemoteBranch()` parser works with
async factory support in derived parsers:

~~~~ typescript twoslash
import { gitRemote, gitRemoteBranch } from "@optique/git";
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";

// Wrap gitRemote() as a dependency source
const remoteParser = dependency(gitRemote());

// Create a derived parser that validates branches against the selected remote
const branchParser = remoteParser.derive({
  metavar: "BRANCH",
  factory: (remote) => gitRemoteBranch(remote),
  defaultValue: () => "origin",
});

const pullCommand = object({
  remote: option("--remote", remoteParser),
  branch: option("--branch", branchParser),
});

// Now --branch validates against the remote specified by --remote:
// myapp pull --remote upstream --branch feature/new
// → validates that "feature/new" exists on "upstream"
~~~~

Since `gitRemoteBranch()` returns an async parser, the derived parser
automatically becomes async. The dependency system handles the mode
combination seamlessly.


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

 -  Full 40-character SHA: `d670460b4b4aece5915caf5c68d12f560a9fe3e4`
 -  Shortened SHAs (4+ characters): `d670460`, `d670460b4b4a`

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

const git = createGitParsers({
  dir: "/path/to/repo",
  metavar: "REF",
});

// Override metavar for specific parser
const branchParser = git.branch({ metavar: "BRANCH_NAME" });
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


Custom error messages
---------------------

You can customize error messages using the `errors` option with the `Message`
type from `@optique/core/message`:

~~~~ typescript twoslash
import { gitBranch } from "@optique/git";
import { message, valueSet } from "@optique/core/message";

const parser = gitBranch({
  errors: {
    notFound: (input, available) =>
      message`Branch ${input} not found. Available: ${
        available ? valueSet(available) : "none"
      }`,
    listFailed: (dir) =>
      message`Cannot read git repository at ${dir}`,
  }
});
~~~~

### Error types

The `errors` option supports the following error types:

 -  `notFound(input, available?)` — Called when the git reference is not found.
    Provides the invalid input and optionally a list of available references.
 -  `listFailed(dir)` — Called when listing git references fails, typically
    when the directory is not a valid git repository.
 -  `invalidFormat(input)` — Called for commit SHA validation failures
    when the input format is invalid (e.g., too short).

### Example with gitCommit

~~~~ typescript twoslash
import { gitCommit } from "@optique/git";
import { message } from "@optique/core/message";

const parser = gitCommit({
  errors: {
    invalidFormat: (input) =>
      message`${input} must be 4-40 characters.`,
    notFound: (input) =>
      message`Commit ${input} not found in repository.`,
  }
});
~~~~

### Example with createGitParsers

~~~~ typescript twoslash
import { createGitParsers } from "@optique/git";
import { message } from "@optique/core/message";

const git = createGitParsers({
  errors: {
    notFound: (input, available) =>
      message`${input} is not a valid reference.`,
  }
});

const branchParser = git.branch();
const tagParser = git.tag();
const commitParser = git.commit();
~~~~


Metavar defaults
----------------

Each parser uses an appropriate default metavar for help text:

| Parser              | Default metavar |
| ------------------- | --------------- |
| `gitBranch()`       | `"BRANCH"`      |
| `gitTag()`          | `"TAG"`         |
| `gitRemote()`       | `"REMOTE"`      |
| `gitRemoteBranch()` | `"BRANCH"`      |
| `gitCommit()`       | `"COMMIT"`      |
| `gitRef()`          | `"REF"`         |

Override with the `metavar` option:

~~~~ typescript twoslash
import { gitBranch, gitTag } from "@optique/git";

const branchParser = gitBranch({ metavar: "BRANCH_NAME" });
const tagParser = gitTag({ metavar: "RELEASE_VERSION" });
~~~~


Exported utilities
------------------

The package also re-exports several utilities from isomorphic-git for
advanced use cases:

~~~~ typescript twoslash
import { expandOid, listBranches, listTags, listRemotes, readObject, resolveRef } from "@optique/git";
~~~~

 -  `expandOid()` — Expand short SHAs to full OIDs
 -  `listBranches()` — List all local branches
 -  `listTags()` — List all tags
 -  `listRemotes()` — List all remotes
 -  `readObject()` — Read a Git object
 -  `resolveRef()` — Resolve a ref to its OID


Complete example
----------------

A Git-like CLI application using Git parsers:

~~~~ typescript twoslash
import { createGitParsers } from "@optique/git";
import { object, or } from "@optique/core/constructs";
import { argument, command, constant, option } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";

const git = createGitParsers();

const checkoutCmd = command("checkout", object({
  type: constant("checkout"),
  branch: option("-b", "--branch", git.branch()),
  startPoint: argument(git.ref()),
}));

const logCmd = command("log", object({
  type: constant("log"),
  ref: argument(git.ref()),
}));

const app = or(checkoutCmd, logCmd);
// ---cut-before---
const result = await parseAsync(app, ["checkout", "-b", "develop", "main"]);
if (result.success) {
  console.log(result.value);
}
~~~~
