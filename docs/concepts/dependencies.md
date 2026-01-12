---
description: >-
  Inter-option dependencies allow one option's valid values to depend on
  another option's value, enabling dynamic validation and context-aware
  shell completion.
---

Inter-option dependencies
=========================

Sometimes the valid values for one command-line option depend on the value of
another option. For example, a `--log-level` option might accept different
values depending on whether `--mode` is set to `dev` or `prod`. Optique's
dependency system provides type-safe support for these inter-option
relationships.

The dependency system works by deferring the final validation of dependent
options until all options have been parsed. During parsing, dependent options
store their raw input along with a preliminary result. After all options are
collected, the system resolves dependencies and re-validates dependent options
using the actual dependency values.


Creating a dependency source
----------------------------

To create a dependency relationship, first wrap an existing value parser with
`dependency()` to create a *dependency source*. A dependency source is a
value parser that can be referenced by other parsers:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { choice } from "@optique/core/valueparser";

// Create a dependency source from a choice parser
const modeParser = dependency(choice(["dev", "prod"] as const));
~~~~

The `dependency()` function returns a `DependencySource` that behaves exactly
like the wrapped parser but can be used to create derived parsers.


Creating a derived parser
-------------------------

Once you have a dependency source, use its `derive()` method to create a
*derived parser*. The derived parser's behavior depends on the source's value:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { choice } from "@optique/core/valueparser";

const modeParser = dependency(choice(["dev", "prod"] as const));
// ---cut-before---
// Create a derived parser that depends on the mode
const logLevelParser = modeParser.derive({
  metavar: "LEVEL",
  factory: (mode) => {
    // Return different choices based on the mode value
    if (mode === "dev") {
      return choice(["debug", "info", "warn", "error"]);
    } else {
      return choice(["warn", "error"]);
    }
  },
  defaultValue: () => "dev" as const,
});
~~~~

The `derive()` method takes an options object with three properties:

`metavar`
:   The metavariable name shown in help text (e.g., `"LEVEL"`).

`factory`
:   A function that receives the dependency's value and returns a value parser.
    This function is called during dependency resolution with the actual
    dependency value.

`defaultValue`
:   A function that returns the default value to use when the dependency
    is not provided. This allows the derived parser to work even when the
    dependency option is omitted.


Using dependencies in parsers
-----------------------------

Use the dependency source and derived parser as regular value parsers in
your option definitions:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { parseSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";

const modeParser = dependency(choice(["dev", "prod"] as const));

const logLevelParser = modeParser.derive({
  metavar: "LEVEL",
  factory: (mode) =>
    choice(mode === "dev"
      ? ["debug", "info", "warn", "error"]
      : ["warn", "error"]),
  defaultValue: () => "dev" as const,
});
// ---cut-before---
const parser = object({
  mode: option("--mode", modeParser),
  logLevel: option("--log-level", logLevelParser),
});

// In dev mode, debug and info are valid
const result1 = parseSync(parser, ["--mode", "dev", "--log-level", "debug"]);
// result1.value = { mode: "dev", logLevel: "debug" }

// In prod mode, only warn and error are valid
const result2 = parseSync(parser, ["--mode", "prod", "--log-level", "warn"]);
// result2.value = { mode: "prod", logLevel: "warn" }
~~~~

The dependency resolution happens automatically in `object().complete()`,
so you don't need any special handling beyond using the dependency source
and derived parser together.


Option ordering independence
----------------------------

The dependency system handles options in any order. Even if the dependent
option appears before its dependency on the command line, the resolution
works correctly:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { parseSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";

const modeParser = dependency(choice(["dev", "prod"] as const));

const logLevelParser = modeParser.derive({
  metavar: "LEVEL",
  factory: (mode) =>
    choice(mode === "dev"
      ? ["debug", "info", "warn", "error"]
      : ["warn", "error"]),
  defaultValue: () => "dev" as const,
});

const parser = object({
  mode: option("--mode", modeParser),
  logLevel: option("--log-level", logLevelParser),
});
// ---cut-before---
// --log-level appears before --mode, but resolution still works
const result = parseSync(parser, [
  "--log-level", "error",
  "--mode", "prod"
]);
// result.value = { mode: "prod", logLevel: "error" }
~~~~


Default value behavior
----------------------

When the dependency option is not provided, the derived parser uses its
`defaultValue` function to determine the dependency value:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { parseSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";

const modeParser = dependency(choice(["dev", "prod"] as const));

const logLevelParser = modeParser.derive({
  metavar: "LEVEL",
  factory: (mode) =>
    choice(mode === "dev"
      ? ["debug", "info", "warn", "error"]
      : ["warn", "error"]),
  defaultValue: () => "dev" as const,  // Default to dev mode
});

const parser = object({
  mode: optional(option("--mode", modeParser)),
  logLevel: option("--log-level", logLevelParser),
});
// ---cut-before---
// Without --mode, defaultValue() returns "dev"
// So "debug" is valid (it's in the dev mode choices)
const result = parseSync(parser, ["--log-level", "debug"]);
// result.value = { mode: undefined, logLevel: "debug" }
~~~~


Multiple dependencies with `deriveFrom()`
-----------------------------------------

For parsers that depend on multiple options, use the `deriveFrom()` function
instead of the `derive()` method:

~~~~ typescript twoslash
import { dependency, deriveFrom } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";

// Create multiple dependency sources
const envParser = dependency(choice(["local", "staging", "production"] as const));
const regionParser = dependency(choice(["us", "eu", "asia"] as const));

// Create a parser that depends on both
const serverParser = deriveFrom({
  metavar: "SERVER",
  dependencies: [envParser, regionParser] as const,
  factory: (env, region) => {
    // Generate valid servers based on both environment and region
    const servers = [];
    if (env === "local") {
      servers.push("localhost");
    } else {
      servers.push(`${env}-${region}-1`, `${env}-${region}-2`);
    }
    return choice(servers);
  },
  defaultValues: () => ["local", "us"] as const,
});

const parser = object({
  env: option("--env", envParser),
  region: option("--region", regionParser),
  server: option("--server", serverParser),
});
~~~~


Shell completion support
------------------------

The dependency system integrates with Optique's shell completion. When
generating completions for a derived parser, the system uses the default
dependency value to determine which completions to suggest. This provides
useful suggestions even when the dependency hasn't been specified yet on
the command line.

> [!NOTE]
> Currently, shell completion for derived parsers uses the default dependency
> value. Future versions may support context-aware completion that considers
> already-typed dependency values on the command line.


Practical example: Git-like CLI
-------------------------------

Here's a more realistic example showing how dependencies can be used in
a Git-like CLI where the valid branches depend on the remote:

~~~~ typescript twoslash
declare function fetchRemotes(): string[];
declare function fetchBranches(remote: string): string[];
// ---cut-before---
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";

// Remote is a dependency source
const remoteParser = dependency(choice(fetchRemotes()));

// Branch depends on which remote is selected
const branchParser = remoteParser.derive({
  metavar: "BRANCH",
  factory: (remote) => choice(fetchBranches(remote)),
  defaultValue: () => "origin",
});

const pushCommand = object({
  remote: argument(remoteParser),
  branch: argument(branchParser),
  force: option("-f", "--force"),
});
~~~~


Limitations
-----------

The current dependency implementation has some limitations to be aware of:

 -  *No nested dependencies*: A derived parser cannot itself be used as a
    dependency source. Dependencies form a single level of relationships.

 -  *Sync factory only*: The `factory` function must be synchronous.
    Async operations (like fetching valid values from a server) should be
    performed before parser construction.

 -  *Single object scope*: Dependencies are resolved within a single `object()`
    combinator. Cross-object dependencies are not supported.
