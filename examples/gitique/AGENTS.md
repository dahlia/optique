AGENTS.md
=========

This file provides guidance to LLM coding agents when working with code in
this example project.


Project overview
----------------

Gitique is a realistic Git CLI implementation built with [Optique] and
[es-git], demonstrating how to construct sophisticated command-line interfaces
using type-safe combinatorial parsing.  It implements core Git operations
(add, commit, diff, log, reset, status) while showcasing Optique's capabilities
for building production-quality CLIs with full TypeScript type inference.

Key characteristics:

 -  Built with **@optique/core** and **@optique/run** for type-safe CLI parsing
 -  Uses **es-git** for modern Git operations
 -  Multi-runtime support: Deno, Node.js, and Bun
 -  Demonstrative example (not for production use)

[Optique]: https://github.com/dahlia/optique
[es-git]: https://github.com/toss/es-git


File structure
--------------

~~~~
examples/gitique/
├── src/
│   ├── index.ts           # Main CLI entry point
│   ├── commands/
│   │   ├── add.ts         # git add command implementation
│   │   ├── commit.ts      # git commit command implementation
│   │   ├── diff.ts        # git diff command implementation
│   │   ├── log.ts         # git log command implementation
│   │   ├── reset.ts       # git reset command implementation
│   │   └── status.ts      # git status command implementation
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
    dispatch using switch/case with discriminated unions.  Demonstrates
    `showDefault`, `brief`, and `footer` options.

 -  **`src/commands/*.ts`**: Each file exports a command parser and an
    `execute*()` function.  Commands demonstrate various Optique features:
    -  `group()` and `merge()` for organizing help text
    -  `choice()` for enumerated values
    -  `withDefault()` for default values
    -  `map()` for transforming parser results

 -  **`src/utils/git.ts`**: Wraps es-git library for repository operations
    including `getRepository()`, `addFile()`, `createCommit()`,
    `getCommitHistory()`, `getStatus()`, and `getDiff()`.

 -  **`src/utils/formatters.ts`**: Provides ANSI color formatting functions
    for terminal output (`formatCommitOneline()`, `formatError()`,
    `formatSuccess()`, `formatStatusShort()`, `formatDiffStats()`, etc.).


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

### diff

Show changes between commits or working tree.

~~~~ bash
gitique diff                         # Show unstaged changes
gitique diff --cached, --staged      # Show staged changes
gitique diff HEAD~1                  # Compare with previous commit
gitique diff --stat                  # Show diffstat summary
gitique diff --name-only             # Show only file names
gitique diff --name-status           # Show file names with status
gitique diff -U, --unified LINES     # Set context lines (default: 3)
gitique diff --diff-algorithm ALG    # Choose algorithm
~~~~

### log

View commit history.

~~~~ bash
gitique log                     # Show detailed commit history
gitique log --oneline           # Show one-line format
gitique log --format FORMAT     # Choose format (oneline, short, medium, full)
gitique log -n, --max-count N   # Limit number of commits (default: 10)
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
gitique reset --mode MODE       # Choose mode (soft, mixed, hard)
gitique reset --hard [COMMIT]   # Reset everything (DANGEROUS)
gitique reset -q, --quiet       # Suppress output
~~~~

### status

Show working tree status.

~~~~ bash
gitique status                  # Show full status
gitique status -s, --short      # Show short format
gitique status --porcelain      # Machine-readable format
gitique status --format FORMAT  # Choose format (long, short, porcelain)
gitique status -b, --branch     # Show branch information
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
const parser = or(addCommand, commitCommand, logCommand, ...);

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
 -  **`group()`**: Organizes options into logical groups in help text
 -  **`merge()`**: Combines multiple parser groups into one
 -  **`choice()`**: Defines enumerated value options
 -  **`withDefault()`**: Provides default values for options
 -  **`map()`**: Transforms parser results (e.g., shorthand flag handling)

### Option grouping pattern

Commands use `group()` and `merge()` to organize options into logical sections:

~~~~ typescript
const displayOptions = group("Display Options", object({
  format: withDefault(
    option("--format", choice(["oneline", "short", "medium", "full"])),
    "medium",
  ),
  oneline: option("--oneline"),
}));

const filterOptions = group("Filter Options", object({
  since: optional(option("--since", string())),
  author: optional(option("--author", string())),
}));

const parser = merge(
  object({ command: constant("log" as const) }),
  displayOptions,
  filterOptions,
);
~~~~

### Shorthand flag pattern

Commands use `map()` to handle shorthand flags that override option values:

~~~~ typescript
const logOptionsParser = map(
  merge(
    object({ command: constant("log" as const) }),
    displayOptions,
    filterOptions,
  ),
  (result) => ({
    ...result,
    // Handle --oneline shorthand by overriding format
    format: result.oneline ? "oneline" : result.format,
  }),
);
~~~~

### Choice value parser pattern

Commands use `choice()` for enumerated values with automatic validation:

~~~~ typescript
const resetModes = ["soft", "mixed", "hard"] as const;

const modeOption = withDefault(
  option("--mode", choice(resetModes, { metavar: "MODE" }), {
    description: message`Reset mode`,
  }),
  "mixed" as const,
);
~~~~

### Run options pattern

The main entry point demonstrates various `run()` options:

~~~~ typescript
const result = run(parser, {
  programName: "gitique",
  help: "both",         // Enable both --help and help command
  completion: "both",   // Enable completion command and --completion
  showDefault: true,    // Display default values in help
  brief: message`A Git-like CLI built with Optique`,
  footer: message`For more info, visit https://github.com/dahlia/optique`,
});
~~~~


Dependencies
------------

 -  **@optique/core**: Type-safe parser combinators (workspace package)
 -  **@optique/run**: Process integration wrapper (workspace package)
 -  **es-git**: Git library for modern Node.js/Deno
