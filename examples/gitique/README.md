Gitique: Git CLI built with Optique
===================================

> [!CAUTION]
> This is an example project for demonstration purposes.
> While functional, it implements only a subset of Git's features
> and is not intended for production use.

*A realistic Git CLI implementation showcasing [Optique]'s type-safe
combinatorial parsing and [es-git]'s modern Git operations.*

Gitique demonstrates how to build sophisticated command-line interfaces using
Optique's composable parsers combined with es-git's Git repository operations.
It provides a realistic example of multi-runtime CLI development with full
type safety and automatic type inference.

> [!NOTE]
> This project was *vibe-coded* using [Claude Code], Anthropic's official
> CLI for Claude, showcasing rapid prototyping and iterative development
> with AI assistance.

[Optique]: https://github.com/dahlia/optique
[es-git]: https://es-git.dev/
[Claude Code]: https://claude.ai/code


Features
--------

Gitique implements core Git commands with full type safety:

 -  **`add`** — Stage files for commit with `--all` and `--force` options
 -  **`commit`** — Create commits with messages, custom authors, and staging
 -  **`diff`** — Show changes with various display modes (patch, stat, name-only)
 -  **`log`** — View commit history with filtering, formatting, and search
 -  **`reset`** — Reset repository state with soft/mixed/hard modes
 -  **`status`** — Show working tree status in long, short, or porcelain format

This example demonstrates Optique's key capabilities:

 -  *Command combinators*: `command()`, `or()`, `object()` for structured CLIs
 -  *Option grouping*: `group()` and `merge()` for organized help text
 -  *Option parsing*: `option()`, `optional()`, `multiple()` with type inference
 -  *Value parsers*: `string()`, `integer()`, `choice()` with validation
 -  *Default values*: `withDefault()` with automatic help text display
 -  *Result transformation*: `map()` for shorthand flag handling
 -  *Help generation*: Automatic `--help` and `help` command support
 -  *Shell completion*: Built-in completion support for Bash, zsh, fish, and Nushell
 -  *Error handling*: User-friendly error messages with usage information


Installation
------------

### Prerequisites

 -  *Deno* 2.3.0+, *Node.js* 20.0.0+, or *Bun* 1.2.0+
 -  A Git repository to operate on

### Setup

~~~~ bash
# Clone the Optique repository
git clone https://github.com/dahlia/optique.git
cd optique/examples/gitique

# For Node.js/Bun (install dependencies)
pnpm install

# For Deno (dependencies loaded automatically)
~~~~


Usage
-----

### Running with different runtimes

~~~~ bash
# Deno
deno task start [command] [options]

# Node.js
pnpm start [command] [options]

# Bun
bun run start [command] [options]
~~~~

### Examples

**Adding files:**

~~~~ bash
# Add specific files
gitique add file1.txt file2.js

# Add all files
gitique add --all
gitique add -A

# Verbose output
gitique add --verbose file.txt
~~~~

**Creating commits:**

~~~~ bash
# Commit with message
gitique commit -m "Add new feature"

# Commit with custom author
gitique commit -m "Fix bug" --author "John Doe <john@example.com>"

# Stage all changes and commit
gitique commit -a -m "Update documentation"
~~~~

**Viewing history:**

~~~~ bash
# Show all commits (detailed)
gitique log

# Show commits in one line format
gitique log --oneline

# Limit number of commits
gitique log -n 5

# Filter by author
gitique log --author "John"

# Filter by date range
gitique log --since "2024-01-01" --until "2024-12-31"

# Search commit messages
gitique log --grep "feature"
~~~~

**Checking status:**

~~~~ bash
# Show full status
gitique status

# Show short format
gitique status --short
gitique status -s

# Show machine-readable format
gitique status --porcelain

# Show branch information
gitique status -b
~~~~

**Viewing changes:**

~~~~ bash
# Show unstaged changes
gitique diff

# Show staged changes
gitique diff --cached
gitique diff --staged

# Show change statistics
gitique diff --stat

# Show only changed file names
gitique diff --name-only

# Show file names with status
gitique diff --name-status
~~~~

**Resetting changes:**

~~~~ bash
# Reset staging area (mixed reset - default)
gitique reset

# Soft reset (keep staging area and working directory)
gitique reset --soft HEAD~1

# Hard reset (DANGEROUS - loses all changes)
gitique reset --hard HEAD~1

# Reset specific files
gitique reset file1.txt file2.js
~~~~

**Help system:**

~~~~ bash
# General help
gitique --help
gitique help

# Command-specific help
gitique add --help
gitique help commit
~~~~

**Shell completion:**

~~~~ bash
# Generate Bash completion script
gitique completion bash > ~/.bashrc.d/gitique.bash
source ~/.bashrc.d/gitique.bash

# Generate zsh completion script
gitique completion zsh > ~/.zsh/completions/_gitique

# Test completion
gitique <TAB>                    # Shows: add, commit, diff, log, ...
gitique add --<TAB>              # Shows: --all, --force, --verbose, --help
gitique commit --author <TAB>    # Shows available author suggestions
~~~~


Architecture
------------

### Type-safe command dispatch

Gitique demonstrates Optique's discriminated union pattern for type-safe
command handling:

~~~~ typescript
// Using constant() parsers for type-safe command identification
const addOptions = object({
  command: constant("add" as const),
  all: option("-A", "--all"),
  force: option("-f", "--force"),
  files: multiple(argument(string())),
});

type AddConfig = InferValue<typeof addOptions>;
// AddConfig = {
//   command: "add";
//   all: boolean;
//   force: boolean;
//   files: string[];
// }

// Combining commands with type-safe union types
const parser = or(
  addCommand,      // InferValue = AddConfig
  commitCommand,   // InferValue = CommitConfig
  diffCommand,     // InferValue = DiffConfig
  logCommand,      // InferValue = LogConfig
  resetCommand,    // InferValue = ResetConfig
  statusCommand,   // InferValue = StatusConfig
);

// Type-safe command dispatch
switch (result.command) {
  case "add":
    await executeAdd(result); // result is AddConfig
    break;
  case "commit":
    await executeCommit(result); // result is CommitConfig
    break;
  // TypeScript ensures all cases are covered
}
~~~~

This pattern provides:

 -  *Type safety*: TypeScript automatically narrows types in each case
 -  *Exhaustiveness*: Compiler ensures all command cases are handled
 -  *IntelliSense*: Full autocompletion for command-specific options
 -  *Refactor safety*: Adding new commands requires updating all switches

### Project structure

~~~~
src/
├── index.ts              # Main CLI entry point with command dispatch
├── commands/
│   ├── add.ts            # git add implementation
│   ├── commit.ts         # git commit implementation
│   ├── diff.ts           # git diff implementation
│   ├── log.ts            # git log implementation
│   ├── reset.ts          # git reset implementation
│   └── status.ts         # git status implementation
└── utils/
    ├── git.ts            # es-git wrapper utilities
    └── formatters.ts     # Output formatting functions
~~~~


Example walkthrough
-------------------

This example demonstrates key Optique patterns in a realistic CLI application:

### 1. Parser composition

~~~~ typescript
import { run } from "@optique/run";
import { command, constant, object, option, or } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = or(
  command("add", object({
    command: constant("add" as const),
    all: option("-A", "--all"),
    force: option("-f", "--force"),
    files: multiple(argument(string())),
  })),
  command("commit", object({
    command: constant("commit" as const),
    message: option("-m", "--message", string()),
    all: option("-a", "--all"),
    author: optional(option("--author", string())),
  })),
);

const result = run(parser);
// TypeScript infers: AddConfig | CommitConfig
~~~~

### 2. Option grouping with defaults

~~~~ typescript
import { group, merge, object } from "@optique/core/constructs";
import { map, withDefault } from "@optique/core/modifiers";
import { choice } from "@optique/core/valueparser";

const formatChoices = ["oneline", "short", "medium", "full"] as const;

// Group related options for organized help text
const displayOptions = group("Display Options", object({
  format: withDefault(
    option("--format", choice(formatChoices)),
    "medium" as const,
  ),
  oneline: option("--oneline"),
}));

// Use map() to handle shorthand flags
const logParser = map(
  merge(
    object({ command: constant("log" as const) }),
    displayOptions,
  ),
  (result) => ({
    ...result,
    format: result.oneline ? "oneline" : result.format,
  }),
);
~~~~

### 3. Type-safe execution

~~~~ typescript
// Compiler ensures exhaustive handling
switch (result.command) {
  case "add":
    console.log(`Adding ${result.files.length} files.`);
    if (result.all) console.log("Adding all files.");
    break;
  case "commit":
    console.log(`Committing: ${result.message}.`);
    if (result.author) console.log(`Author: ${result.author}.`);
    break;
  default:
    const _exhaustive: never = result; // Compilation error if missing cases
}
~~~~


Building and testing
--------------------

~~~~ bash
# TypeScript compilation (Node.js/Bun)
pnpm build

# Type checking (Deno)
deno check src/index.ts

# Lint and format
deno fmt
deno lint

# Test in a Git repository
cd /path/to/git/repo

# Try different commands
gitique log --oneline
gitique add .
gitique commit -m "Test commit"
~~~~


Key technologies
----------------

 -  [Optique]: Type-safe combinatorial CLI parser providing the foundation
    for all command parsing and automatic type inference
 -  [es-git]: Modern Git library for Node.js with blazing-fast installation
    and rock-solid stability, powered by N-API


What this example teaches
-------------------------

1.  *Parser composition*: How Optique's combinators create complex, type-safe
    CLI interfaces
2.  *Option organization*: Using `group()` and `merge()` to structure help text
    into logical sections
3.  *Discriminated unions*: Using `constant()` parsers for type-safe command
    identification and dispatch
4.  *Default values*: Using `withDefault()` to provide defaults shown in help
5.  *Shorthand patterns*: Using `map()` to transform results for flag aliases
6.  *Multi-runtime compatibility*: Single codebase supporting Deno, Node.js,
    and Bun
7.  *Real-world integration*: Connecting type-safe parsers with external
    libraries (es-git)
8.  *Error handling*: Graceful error handling with user-friendly messages
9.  *Help generation*: Automatic documentation from parser definitions


Extending this example
----------------------

Potential improvements and additions:

1.  *Add more commands*: `branch`, `merge`, `checkout`, `stash`
2.  *Enhanced Git integration*: More complete es-git feature usage
3.  *Configuration*: Support for Git config files and settings
4.  *Performance*: Optimize for large repositories
5.  *Testing*: Add comprehensive test suite
6.  *Documentation*: Generate docs from Optique parser definitions


Credits
-------

Gitique was *vibe-coded* using [Claude Code], showcasing how AI-assisted
development can rapidly prototype and iterate on complex CLI applications
with multiple technologies.

<!-- cSpell: ignore gitique -->
