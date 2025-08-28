<img src="docs/public/optique.svg" width="128" height="58" align="right">

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
import { object, option, optional, or, merge, constant } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Reusable parser components
const commonOptions = object({
  verbose: option("-v", "--verbose"),
  config: optional(option("-c", "--config", string())),
});

// Mutually exclusive deployment strategies
const localDeploy = object({
  mode: constant("local" as const),
  path: option("--path", string()),
  port: option("--port", integer({ min: 1000 })),
});

const cloudDeploy = object({
  mode: constant("cloud" as const),
  provider: option("--provider", string()),
  region: option("--region", string()),
  apiKey: option("--api-key", string()),
});

// Compose parsers with type-safe constraints
const parser = merge(
  commonOptions,
  or(localDeploy, cloudDeploy)
);

const config = run(parser, { help: "both" });
// config: {
//   readonly verbose: boolean;
//   readonly config: string | undefined;
// } & (
//   | {
//       readonly mode: "local";
//       readonly path: string;
//       readonly port: number;
//   }
//   | {
//       readonly mode: "cloud";
//       readonly provider: string;
//       readonly region: string;
//       readonly apiKey: string;
//   }
// )

// TypeScript knows exactly what's available based on the mode
if (config.mode === "local") {
  console.log(`Deploying to ${config.path} on port ${config.port}`);
} else {
  console.log(`Deploying to ${config.provider} in ${config.region}`);
}
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
