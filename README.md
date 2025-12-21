<img src="docs/public/optique.svg" width="128" height="58" align="right">

Optique: Type-safe combinatorial CLI parser for TypeScript
==========================================================

[![JSR][JSR badge]][JSR]
[![npm][npm badge]][npm]
[![Bundlephobia][Bundlephobia badge]][Bundlephobia]
[![GitHub Actions][GitHub Actions badge]][GitHub Actions]

> [!WARNING]
> The API is stabilizing, but may change before the 1.0 release.

Type-safe combinatorial CLI parser for TypeScript inspired by Haskell's
[optparse-applicative] and TypeScript's [Zod]. Build composable parsers for
command-line interfaces with full type safety, automatic type inference, and
built-in shell completion support for Bash, zsh, fish, PowerShell, and Nushell.

> [!NOTE]
> Optique is a parsing library that focuses on extracting and validating
> command-line arguments. It doesn't dictate your application's structure,
> handle command execution, or provide scaffolding—it simply transforms
> command-line input into well-typed data structures.

[JSR]: https://jsr.io/@optique
[JSR badge]: https://jsr.io/badges/@optique/core
[npm]: https://www.npmjs.com/package/@optique/core
[npm badge]: https://img.shields.io/npm/v/@optique/core?logo=npm
[Bundlephobia]: https://bundlephobia.com/package/@optique/core
[Bundlephobia badge]: https://badgen.net/bundlephobia/dependency-count/@optique/core
[GitHub Actions]: https://github.com/dahlia/optique/actions/workflows/main.yaml
[GitHub Actions badge]: https://github.com/dahlia/optique/actions/workflows/main.yaml/badge.svg
[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Features
--------

 -  *Parser combinators*: `object()`, `or()`, `merge()`, `optional()`,
    `multiple()`, `map()`, and more for composable CLI parsing
 -  *Full type safety*: Automatic TypeScript type inference for all parser
    compositions with compile-time validation
 -  *Rich value parsers*: Built-in parsers for strings, numbers, URLs, locales,
    UUIDs, temporal types (via *@optique/temporal*), Zod schemas
    (via *@optique/zod*), and Valibot schemas (via *@optique/valibot*)
 -  *Shell completion*: Automatic completion script generation for Bash, zsh,
    fish, PowerShell, and Nushell
 -  *Smart error messages*: “Did you mean?” suggestions for typos with
    context-aware error formatting
 -  *Automatic help generation*: Beautiful help text with usage formatting,
    labeled sections, and colored output
 -  *Multi-runtime support*: Works seamlessly with Deno, Node.js, and Bun
 -  *CLI integration*: Complete CLI setup with `run()` function including help,
    version, and completion support


Quick example
-------------

~~~~ typescript
import { object, option, optional, or, merge, constant } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
import { run, print } from "@optique/run";

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
  print(`Deploying to ${config.path} on port ${config.port}.`);
} else {
  print(`Deploying to ${config.provider} in ${config.region}.`);
}
~~~~


Docs
----

Optique provides comprehensive documentation to help you get started quickly:
<https://optique.dev/>.

 -  [Why Optique?] — What makes Optique different from other CLI libraries
 -  [Tutorial] — Step-by-step guide from simple options to nested subcommands
 -  [Cookbook] — Practical recipes for common CLI patterns including shell
    completion

API reference documentation for each package is available on JSR (see below).

[Why Optique?]: https://optique.dev/why
[Tutorial]: https://optique.dev/tutorial
[Cookbook]: https://optique.dev/cookbook


Packages
--------

Optique is a monorepo which contains multiple packages.  The main package is
*@optique/core*, which provides the shared types and parser combinators.
The following is a list of the available packages:

| Package                                      | JSR                              | npm                              | Description                                 |
| -------------------------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------- |
| [@optique/core](/packages/core/)             | [JSR][jsr:@optique/core]         | [npm][npm:@optique/core]         | Shared types and parser combinators         |
| [@optique/run](/packages/run/)               | [JSR][jsr:@optique/run]          | [npm][npm:@optique/run]          | Runner for Node.js/Deno/Bun                 |
| [@optique/logtape](/packages/logtape/)       | [JSR][jsr:@optique/logtape]      | [npm][npm:@optique/logtape]      | [LogTape] logging integration               |
| [@optique/temporal](/packages/temporal/)     | [JSR][jsr:@optique/temporal]     | [npm][npm:@optique/temporal]     | [Temporal] value parsers (date and time)    |
| [@optique/valibot](/packages/valibot/)       | [JSR][jsr:@optique/valibot]      | [npm][npm:@optique/valibot]      | [Valibot] schema integration for validation |
| [@optique/zod](/packages/zod/)               | [JSR][jsr:@optique/zod]          | [npm][npm:@optique/zod]          | [Zod] schema integration for validation     |

[jsr:@optique/core]: https://jsr.io/@optique/core
[npm:@optique/core]: https://www.npmjs.com/package/@optique/core
[jsr:@optique/run]: https://jsr.io/@optique/run
[npm:@optique/run]: https://www.npmjs.com/package/@optique/run
[jsr:@optique/logtape]: https://jsr.io/@optique/logtape
[npm:@optique/logtape]: https://www.npmjs.com/package/@optique/logtape
[jsr:@optique/temporal]: https://jsr.io/@optique/temporal
[npm:@optique/temporal]: https://www.npmjs.com/package/@optique/temporal
[jsr:@optique/valibot]: https://jsr.io/@optique/valibot
[npm:@optique/valibot]: https://www.npmjs.com/package/@optique/valibot
[jsr:@optique/zod]: https://jsr.io/@optique/zod
[npm:@optique/zod]: https://www.npmjs.com/package/@optique/zod
[LogTape]: https://logtape.org/
[Temporal]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal
[Valibot]: https://valibot.dev/
[Zod]: https://zod.dev/
