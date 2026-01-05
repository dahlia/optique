Guidance for LLM-based code agents
==================================

This file provides guidance to LLM-based code agents (e.g., Claude Code,
OpenCode) when working with code in this repository.


Project overview
----------------

Optique is a type-safe combinatorial CLI parser for TypeScript, inspired by
Haskell's [optparse-applicative] and TypeScript's [Zod].  It provides a
functional approach to building command-line interfaces using composable
parsers with full type safety.

This project is hosted on GitHub at [dahlia/optique](https://github.com/dahlia/optique).

[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Development commands
--------------------

This is a polyglot monorepo supporting Deno, Node.js, and Bun.
Use [mise] to manage runtime versions and run development tasks.

[mise]: https://mise.jdx.dev/

### Package manager

This project uses Deno as the primary development tool and pnpm for
npm-related tasks (building for npm publishing).

> [!IMPORTANT]
> Do *not* use npm or Yarn as package managers in this project.  Always use
> mise tasks (`mise run ...` or `mise <task>`) for development workflows.

### Installation

~~~~ bash
mise install  # Install runtime tools (Deno, Node.js, Bun, pnpm)
mise deps     # Install project dependencies
~~~~

### Quality checks

~~~~ bash
mise check       # Type check, lint, format check, and dry-run publish
deno fmt         # Format code
deno lint        # Run linter
~~~~

### Testing

~~~~ bash
mise test:deno   # Run tests with Deno (primary test environment)
mise test:node   # Run tests with Node.js
mise test:bun    # Run tests with Bun
mise test        # Run all checks and tests across all runtimes
~~~~

### Building (for npm publishing)

~~~~bash
mise build       # Build all packages with tsdown
~~~~

### Version management

All packages must share the same version.  Use the check-versions task:

~~~~ bash
mise check-versions          # Check for version mismatches
mise check-versions --fix    # Auto-fix version mismatches
~~~~

### Adding dependencies

When adding new dependencies, always check for the latest version:

 -  *npm packages*: Use `npm view <package> version` to find the latest version
 -  *JSR packages*: Use the [JSR API] to find the latest version

Always prefer the latest stable version unless there is a specific reason
to use an older version.

> [!IMPORTANT]
> Because this project supports both Deno and Node.js/Bun, dependencies must
> be added to *both* configuration files:
>
>  -  *deno.json*: Add to the `imports` field (for Deno)
>  -  *package.json*: Add to `dependencies` or `devDependencies` (for Node.js/Bun)
>
> For workspace packages, use the pnpm catalog (*pnpm-workspace.yaml*) to manage
> versions centrally.  In *package.json*, reference catalog versions with
> `"catalog:"` instead of hardcoding version numbers.
>
> Forgetting to add a dependency to *package.json* will cause Node.js and Bun
> tests to fail with `ERR_MODULE_NOT_FOUND`, even if Deno tests pass.

[JSR API]: https://jsr.io/docs/api

### Temporary scripts

When creating temporary test scripts, save them in the *tmp/* directory
at the project root (not the system */tmp* directory).  This directory is
already in *.gitignore*.

Using the project-local *tmp/* directory allows you to import `@optique/*`
packages with relative imports, whereas using the system */tmp* would require
absolute paths since it is outside the workspace.


Architecture
------------

### Package structure

 -  *@optique/core* (*packages/core/*): Core parsing library.  Contains parser
    combinators (`parser.ts`), value parsers (`valueparser.ts`), help text
    generation (`usage.ts`), and error handling (`message.ts`).
    This package is pure TypeScript and works in any JavaScript environment.
 -  *@optique/run* (*packages/run/*): CLI integration wrapper.  Provides
    process-integrated `run()` function, argument reading from `process.argv`
    or `Deno.args`, and `process.exit()` handling.
  -  *@optique/temporal* (*packages/temporal/*): Temporal/Date parsers.
     Provides parsers for date and time values.
  -  *@optique/git* (*packages/git/*): Git reference parsers. Provides async
     value parsers for validating Git references (branches, tags, commits,
     remotes) using isomorphic-git.


### Dual publishing

Each package is published to both JSR (Deno) and npm (Node.js/Bun):

 -  JSR uses *deno.json* with TypeScript source directly
 -  npm uses *package.json* with tsdown-built *dist/* output (ESM + CJS + .d.ts)

When adding subpath exports to a package, update the following files:

 -  *deno.json*: Add the subpath to the `exports` field
 -  *package.json*: Add the subpath to the `exports` field
 -  *tsdown.config.ts*: Add the entry point to the build configuration

### Adding new packages

When adding a new package to the monorepo, update the following files:

 -  *README.md* (root): Add the package to the Packages table
 -  *AGENTS.md*: Add the package to the Package structure list (if applicable)
 -  *docs/package.json*: Add `"@optique/<name>": "workspace:"` to `devDependencies`
    (required for Twoslash type checking in documentation)


Development practices
---------------------

### Test-driven development

This project follows test-driven development (TDD) practices:

 -  *Write tests first*: Before implementing new functionality, write tests
    that describe the expected behavior.  Confirm that the tests fail before
    proceeding with the implementation.
 -  *Regression tests for bugs*: When fixing bugs, first write a regression
    test that reproduces the bug.  Confirm that the test fails, then fix the
    bug and verify the test passes.

### Commit messages

 -  Do not use Conventional Commits (no `fix:`, `feat:`, etc. prefixes).
    Keep the first line under 50 characters when possible.
 -  Focus on *why* the change was made, not just *what* changed.
 -  When referencing issues or PRs, use permalink URLs instead of just
    numbers (e.g., `#123`).  This preserves context if the repository
    is moved later.
 -  When listing items after a colon, add a blank line after the colon:

    ~~~~
    This commit includes the following changes:

    - Added foo
    - Fixed bar
    ~~~~

 -  When using LLMs or coding agents, include credit via `Co-Authored-By:`.
    Include a permalink to the agent session if available.

### Before committing

 -  *Run all tests*: Before committing any changes, run `mise test` to
    ensure all tests pass across Deno, Node.js, and Bun runtimes.


Code style
----------

### Type safety

 -  All code must be type-safe.  Avoid using the `any` type.
 -  Do not use unsafe type assertions like `as unknown as ...` to bypass
    the type system.
 -  Prefer immutable data structures unless there is a specific reason to
    use mutable ones.  Use `readonly T[]` for array types and add the
    `readonly` modifier to all interface fields.
 -  Use the nullish coalescing operator (`??`) instead of the logical OR
    operator (`||`) for default values.
 -  The library emphasizes compile-time type safety with automatic type inference
    for parser results.  When working with parsers, the TypeScript compiler will
    infer complex union types and optional fields based on the combinator
    composition.

### API documentation

 -  All exported APIs must have JSDoc comments describing their purpose,
    parameters, and return values.
 -  For APIs added in a specific version, include the `@since` tag with the
    version number:

    ~~~~ typescript
    /**
     * Creates a string parser.
     *
     * @returns A parser that accepts any string value.
     * @since 1.2.3
     */
    export function string(): ValueParser<string> {
      // ...
    }
    ~~~~

### Testing

 -  Use the `node:test` and `node:assert/strict` APIs to ensure tests run
    across all runtimes (Node.js, Deno, and Bun).
 -  Test files are co-located with source files using `.test.ts` suffix.
 -  Avoid the `assert.equal(..., true)` or `assert.equal(..., false)` patterns.
    Use `assert.ok(...)` and `assert.ok(!...)` instead.

### Error messages

 -  Prefer specific error types over generic `Error`.  Use built-in types
    like `TypeError`, `RangeError`, or `SyntaxError` when appropriate.
 -  End error messages with a period:

    ~~~~ typescript
    throw new Error("Translation did not complete.");
    ~~~~

 -  When the message ends with a value after a colon, the period can be
    omitted:

    ~~~~ typescript
    throw new Error(`Failed to load file: ${filePath}`);
    ~~~~

 -  Functions or methods that throw exceptions must include the `@throws` tag
    in their JSDoc comments.

### Cross-runtime compatibility

 -  When writing code that runs across Deno, Node.js, and Bun, prefer using
    Node.js built-in modules (e.g., `node:fs`, `node:buffer`, `node:path`,
    `node:test`).  Deno provides compatibility layers for most Node.js
    built-in modules, making them a practical common ground for cross-runtime
    code.
 -  Avoid using Deno-specific APIs (e.g., `Deno.readTextFile()`) in shared
    library code.  Reserve Deno-specific APIs for Deno-only entry points
    or when wrapped with runtime detection.


Writing style
-------------

When writing documentation in English:

 -  Use sentence case for titles and headings (capitalize only the first word
    and proper nouns), not Title Case.
 -  Use *italics* for emphasis rather than **bold**.  Do not overuse emphasis.
 -  Avoid common LLM writing patterns: overusing em dashes, excessive emphasis,
    compulsive summarizing and categorizing, and rigid textbook-like structure
    at the expense of natural flow.


Markdown style guide
--------------------

When creating or editing Markdown documentation files in this project,
follow these style conventions to maintain consistency with existing
documentation:

### Headings

 -  *Setext-style headings*: Use underline-style for the document title
    (with `=`) and sections (with `-`):

    ~~~~
    Document Title
    ==============

    Section Name
    ------------
    ~~~~

 -  *ATX-style headings*: Use only for subsections within a section:

    ~~~~
    ### Subsection Name
    ~~~~

 -  *Heading case*: Use sentence case (capitalize only the first word and
    proper nouns) rather than Title Case:

    ~~~~
    Development commands    ← Correct
    Development Commands    ← Incorrect
    ~~~~

### Text formatting

 -  *Italics* (`*text*`): Use for package names (*@optique/core*,
    *@optique/run*), emphasis, and to distinguish concepts
 -  *Bold* (`**text**`): Use sparingly for strong emphasis
 -  *Inline code* (`` `code` ``): Use for code spans, function names,
    filenames, and command-line options

### Lists

 -  Use ` -  ` (space-hyphen-two spaces) for unordered list items
 -  Indent nested items with 4 spaces
 -  Align continuation text with the item content:

    ~~~~
     -  *First item*: Description text that continues
        on the next line with proper alignment
     -  *Second item**: Another item
    ~~~~

### Code blocks

 -  Use four tildes (`~~~~`) for code fences instead of backticks
 -  Always specify the language identifier:

    ~~~~~
    ~~~~ typescript
    const example = "Hello, world!";
    ~~~~
    ~~~~~

 -  For shell commands, use `bash`:

    ~~~~~
    ~~~~ bash
    deno test
    ~~~~
    ~~~~~

### Links

 -  Use reference-style links placed at the *end of each section*
    (not at document end)
 -  Format reference links with consistent spacing:

    ~~~~
    See the [optparse-applicative] library for inspiration.

    [optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
    ~~~~

### GitHub alerts

Use GitHub-style alert blocks for important information:

 -  *Note*: `> [!NOTE]`
 -  *Tip*: `> [!TIP]`
 -  *Important*: `> [!IMPORTANT]`
 -  *Warning*: `> [!WARNING]`
 -  *Caution*: `> [!CAUTION]`

Continue alert content on subsequent lines with `>`:

~~~~
> [!CAUTION]
> This feature is experimental and may change in future versions.
~~~~

### Tables

Use pipe tables with proper alignment markers:

~~~~
| Feature         | @optique/core | @optique/run |
|-----------------|---------------|--------------|
| Argument source | Manual        | Automatic    |
~~~~

### Spacing and line length

 -  Wrap lines at approximately 80 characters for readability
 -  Use one blank line between sections and major elements
 -  Use two blank lines before Setext-style section headings
 -  Place one blank line before and after code blocks
 -  End sections with reference links (if any) followed by a blank line


VitePress documentation
-----------------------

The *docs/* directory contains VitePress documentation with additional features
beyond standard Markdown.


### Twoslash code blocks

Use the `twoslash` modifier to enable TypeScript type checking and hover
information in code blocks:

~~~~~
~~~~ typescript twoslash
import { run, command, option } from "@optique/run";

const cmd = command("hello", () => "Hello world");
~~~~
~~~~~


### Fixture variables

When code examples need variables that shouldn't be shown to readers,
declare them *before* the `// ---cut-before---` directive.  Content before
this directive is compiled but hidden from display:

~~~~~
~~~~ typescript twoslash
const input = ["--help"];
// ---cut-before---
import { run } from "@optique/run";

await run(cmd, input);
~~~~
~~~~~

The reader sees only the code after `---cut-before---`, but TypeScript
checks the entire block including the hidden fixture.

For functions that need to exist but shouldn't be shown, use `declare`:

~~~~~
~~~~ typescript twoslash
declare function fetchConfig(): Promise<string>;
// ---cut-before---
import { parse } from "@optique/core/parser";

const config = await fetchConfig();
~~~~
~~~~~


### Definition lists

VitePress supports definition lists for documenting terms, options,
or properties:

~~~~
`--help`
:   Show help message

`--version`
:   Show version information
~~~~

This renders as a formatted definition list with the term on one line
and the description indented below.


### Code groups

Use code groups to show the same content for different package managers
or environments:

~~~~
::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/run
~~~~

~~~~ bash [npm]
npm add @optique/run
~~~~

~~~~ bash [pnpm]
pnpm add @optique/run
~~~~

:::
~~~~


### Links

 -  *Internal links*: When linking to other VitePress documents within
    the *docs/* directory, use inline link syntax (e.g.,
    `[text](./path/to/file.md)`) instead of reference-style links.
 -  *Relative paths*: Always use relative paths for internal links.
 -  *File extensions*: Include the `.md` extension in internal link paths.


### Building documentation

~~~~ bash
cd docs
pnpm build    # Build for production (runs Twoslash type checking)
pnpm dev      # Start development server
~~~~

Always run `pnpm build` before committing to catch Twoslash type errors.
