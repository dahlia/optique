AGENTS.md
=========

This file provides guidance to LLM coding agents when working with code in this repository.


Project overview
----------------

Optique is a type-safe combinatorial CLI parser for TypeScript, inspired by
Haskell's [optparse-applicative] and TypeScript's [Zod].  It provides a
functional approach to building command-line interfaces using composable
parsers with full type safety.

The project is structured as a Deno/pnpm monorepo with multi-runtime support:

 -  **Monorepo structure**: pnpm workspace with packages under `packages/`
 -  **Core library**: `packages/core/` contains the main parser implementation
 -  **Multi-runtime**: Supports Deno, Node.js, and Bun
 -  **Build tool**: Uses `tsdown` for TypeScript compilation and distribution

[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Architecture
------------

### Key modules

 -  **`parser.ts`**: Core parser types, combinators (`object()`, `or()`,
    `optional()`, `multiple()`) and parsing logic
 -  **`valueparser.ts`**: Value parsers for converting strings to typed values
    (`string()`, `integer()`, `locale()`, etc.)
 -  **`error.ts`**: Error handling and message formatting


Development commands
--------------------

### Testing

 -  `deno test` — Run tests in Deno (primary test environment)
 -  `deno task test-all` — Run tests across all runtimes (Deno, Node, Bun)
 -  `cd packages/core && deno test` — Run core package tests only

### Building and linting

 -  `deno task check` — Full validation: version check, type check, lint,
    format check, and dry-run publish
 -  `deno fmt` — Format code
 -  `deno lint` — Lint code
 -  `deno check` — Type check
 -  `deno task check-versions` — Ensure version consistency across workspace

### Building the library

 -  `cd packages/core && tsdown` — Build distribution files


Testing framework
-----------------

Tests use Node.js built-in test runner (`node:test`) with assertions from
`node:assert/strict`.  Test files are co-located with source files using
`.test.ts` suffix.

The test architecture includes:

 -  Comprehensive parser combinator tests
 -  Value parser validation tests
 -  Error message formatting tests
 -  Multi-runtime compatibility tests


Development workflow
--------------------

 1. Make changes to source files in `packages/core/src/`
 2. Run `deno test` to verify functionality
 3. Run `deno task check` before committing to ensure all validation passes
 4. The project uses git hooks that run the check task on pre-commit


Type safety focus
-----------------

The library emphasizes compile-time type safety with automatic type inference
for parser results.  When working with parsers, the TypeScript compiler will
infer complex union types and optional fields based on the combinator
composition.
