AGENTS.md
=========

This file provides guidance to LLM coding agents when working with code in
this example project.


Project overview
----------------

Gitique is a realistic Git CLI implementation built with [Optique] and
[es-git], demonstrating how to construct sophisticated command-line interfaces
using type-safe combinatorial parsing.  It implements core Git operations
(add, commit, log, reset) while showcasing Optique's capabilities for building
production-quality CLIs with full TypeScript type inference.

Key characteristics:

 -  Built with **@optique/core** and **@optique/run** for type-safe CLI parsing
 -  Uses **es-git** for modern Git operations
 -  Multi-runtime support: Deno, Node.js, and Bun
 -  Demonstrative example (not for production use)

[Optique]: https://github.com/dahlia/optique
[es-git]: https://github.com/nicolo-ribaudo/es-git


File structure
--------------

~~~~
examples/gitique/
├── src/
│   ├── index.ts           # Main CLI entry point
│   ├── commands/
│   │   ├── add.ts         # git add command implementation
│   │   ├── commit.ts      # git commit command implementation
│   │   ├── log.ts         # git log command implementation
│   │   └── reset.ts       # git reset command implementation
│   └── utils/
│       ├── git.ts         # es-git wrapper utilities
│       └── formatters.ts  # ANSI color output formatting
├── dist/                  # Compiled distribution files
├── deno.json              # Deno configuration
├── package.json           # Node.js/Bun configuration
└── tsdown.config.ts       # Build configuration
~~~~

### Key source files

 -  **`src/index.ts`**: Sets up the CLI with `run()` from *@optique/run*,
    combines command parsers using `or()`, and implements type-safe command
    dispatch using switch/case with discriminated unions.

 -  **`src/commands/*.ts`**: Each file exports a command parser and an
    `execute*()` function.  Parsers use `constant()` to tag their type for
    discriminated union pattern.

 -  **`src/utils/git.ts`**: Wraps es-git library for repository operations
    including `getRepository()`, `addFile()`, `createCommit()`, and
    `getCommitHistory()`.

 -  **`src/utils/formatters.ts`**: Provides ANSI color formatting functions
    for terminal output (`formatCommitOneline()`, `formatError()`,
    `formatSuccess()`, etc.).


CLI commands
------------

### add

Stage files for commit.

~~~~ bash
gitique add [FILES...]       # Add specific files
gitique add -A, --all        # Add all files
gitique add -f, --force      # Force add ignored files
gitique add -v, --verbose    # Show detailed output
~~~~

### commit

Create commits.

~~~~ bash
gitique commit -m, --message TEXT        # Set commit message (required)
gitique commit --author "Name <email>"   # Override author
gitique commit -a, --all                 # Stage all changes first
gitique commit --allow-empty             # Allow empty commits
~~~~

### log

View commit history.

~~~~ bash
gitique log                     # Show detailed commit history
gitique log --oneline           # Show one-line format
gitique log -n, --max-count N   # Limit number of commits
gitique log --since DATE        # Filter by date range start
gitique log --until DATE        # Filter by date range end
gitique log --author PATTERN    # Filter by author (partial match)
gitique log --grep PATTERN      # Filter by commit message
~~~~

### reset

Reset repository state.

~~~~ bash
gitique reset                   # Mixed reset (default)
gitique reset --soft [COMMIT]   # Keep index and working directory
gitique reset --mixed [COMMIT]  # Keep working directory only
gitique reset --hard [COMMIT]   # Reset everything (DANGEROUS)
gitique reset -q, --quiet       # Suppress output
~~~~

### Global options

~~~~ bash
gitique --help              # Show help for command
gitique help COMMAND        # Alternative help syntax
gitique --completion bash   # Generate Bash completion script
gitique --completion zsh    # Generate zsh completion script
~~~~


Development commands
--------------------

### Running with Deno

~~~~ bash
deno task start              # Run with required permissions
~~~~

### Building and running with Node.js

~~~~ bash
pnpm install                 # Install dependencies
pnpm build                   # Compile with tsdown
pnpm start                   # Build and run
~~~~

### Direct execution (after build)

~~~~ bash
node dist/index.js           # Run compiled JavaScript
~~~~


Architecture highlights
-----------------------

### Type-safe command dispatch

The project uses Optique's `constant()` parser combined with discriminated
unions to achieve type-safe command routing:

~~~~ typescript
// Each command uses constant() to tag its type
const addOptions = object({
  command: constant("add" as const),
  // ... options
});

// Combined with or() for union type
const parser = or(addCommand, commitCommand, logCommand, resetCommand);

// TypeScript narrows types in switch statements
switch (result.command) {
  case "add":      // result is guaranteed to be AddConfig
  case "commit":   // result is guaranteed to be CommitConfig
  // ...
}
~~~~

### Key Optique patterns demonstrated

 -  **`object()`**: Combines multiple parsers into a single object parser
 -  **`or()`**: Creates union types from alternative parsers
 -  **`optional()`**: Makes options optional with proper type inference
 -  **`multiple()`**: Handles variadic arguments (e.g., file lists)
 -  **`constant()`**: Tags command types for discriminated unions
 -  **`option()`**: Defines command-line options with flags
 -  **`argument()`**: Defines positional arguments

### Validation pattern

The `reset` command demonstrates validation of mutually exclusive options:

~~~~ typescript
// Validates that --soft, --mixed, --hard are mutually exclusive
if ([soft, mixed, hard].filter(Boolean).length > 1) {
  throw new Error("Cannot use multiple reset modes");
}
~~~~


Dependencies
------------

 -  **@optique/core**: Type-safe parser combinators (workspace package)
 -  **@optique/run**: Process integration wrapper (workspace package)
 -  **es-git**: Git library for modern Node.js/Deno
