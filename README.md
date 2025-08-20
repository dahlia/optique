Optique: Type-safe combinatorial CLI parser for TypeScript
==========================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]

> [!CAUTION]
> Optique is currently in early development and may change significantly.
> Expect breaking changes as we refine the API and features.

Type-safe combinatorial CLI parser for TypeScript inspired by Haskell's
[optparse-applicative] and TypeScript's [Zod]. Build composable parsers for
command-line interfaces with full type safety and automatic type inference.

> [!NOTE]
> Optique is a parsing library that focuses on extracting and validating
> command-line arguments. It doesn't dictate your application's structure,
> handle command execution, or provide scaffolding—it simply transforms
> command-line input into well-typed data structures.

[JSR]: https://jsr.io/@optique
[JSR badge]: https://jsr.io/badges/@optique/core
[npm]: https://www.npmjs.com/package/@optique/core
[npm badge]: https://img.shields.io/npm/v/@optique/core?logo=npm
[GitHub Actions]: https://github.com/dahlia/optique/actions/workflows/main.yaml
[GitHub Actions badge]: https://github.com/dahlia/optique/actions/workflows/main.yaml/badge.svg
[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Quick example
-------------

~~~~ typescript
import { object, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
import { run } from "@optique/run";
import process from "node:process";

const parser = object({
  name: argument(string()),
  age: option("-a", "--age", integer()),
  verbose: option("-v", "--verbose"),
});

const config = run(parser, { help: "both" });

console.log(`Hello ${config.name}!`);
if (config.age) console.log(`You are ${config.age} years old.`);
if (config.verbose) console.log("Verbose mode enabled.");
~~~~


Docs
----

Optique provides comprehensive documentation to help you get started quickly:
<https://optique.dev/>.

API reference documentation for each package is available on JSR (see below).


Packages
--------

Optique is a monorepo which contains multiple packages.  The main package is
*@optique/core*, which provides the shared types and parser combinators.
The following is a list of the available packages:

| Package                          | JSR                      | npm                      | Description                         |
| -------------------------------- | ------------------------ | ------------------------ | ----------------------------------- |
| [@optique/core](/packages/core/) | [JSR][jsr:@optique/core] | [npm][npm:@optique/core] | Shared types and parser combinators |
| [@optique/run](/packages/run/)   | [JSR][jsr:@optique/run]  | [npm][npm:@optique/run]  | Runner for Node.js/Deno/Bun         |

[jsr:@optique/core]: https://jsr.io/@optique/core
[npm:@optique/core]: https://www.npmjs.com/package/@optique/core
[jsr:@optique/run]: https://jsr.io/@optique/run
[npm:@optique/run]: https://www.npmjs.com/package/@optique/run
