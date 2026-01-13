---
description: >-
  Inter-option dependencies allow one option's valid values to depend on
  another option's value, enabling dynamic validation and context-aware
  shell completion.
---

Inter-option dependencies
=========================

*This API is available since Optique 0.10.0.*

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


Async factory support
---------------------

The `factory` function can return either a sync or async value parser.
When the factory returns an async parser, the resulting derived parser
will also be async:

~~~~ typescript twoslash
import type { ValueParser } from "@optique/core/valueparser";
declare function gitRemoteBranch(options: { remote: string }): ValueParser<"async", string>;
// ---cut-before---
import { dependency } from "@optique/core/dependency";
import { string } from "@optique/core/valueparser";

const remoteParser = dependency(string({ metavar: "REMOTE" }));

// Factory returns an async parser - derived parser is also async
const branchParser = remoteParser.derive({
  metavar: "BRANCH",
  factory: (remote) => gitRemoteBranch({ remote }),
  defaultValue: () => "origin",
});

// branchParser.$mode is "async"
~~~~

For explicit control over the factory mode, use `deriveSync()` or
`deriveAsync()` instead of `derive()`:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { choice, string } from "@optique/core/valueparser";

const modeParser = dependency(choice(["dev", "prod"] as const));

// Explicitly sync factory
const logLevelParser = modeParser.deriveSync({
  metavar: "LEVEL",
  factory: (mode) =>
    choice(mode === "dev"
      ? ["debug", "info", "warn", "error"]
      : ["warn", "error"]),
  defaultValue: () => "dev" as const,
});
~~~~

The mode of the resulting derived parser is determined by combining the
source parser's mode and the factory's return mode:

| Source mode | Factory returns | Result mode |
| ----------- | --------------- | ----------- |
| sync        | sync parser     | sync        |
| sync        | async parser    | async       |
| async       | sync parser     | async       |
| async       | async parser    | async       |


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

Dependencies also work across parser combinators like `merge()` and `concat()`.
For example, you can have the dependency source in one `object()` and the
derived parser in another, then combine them with `merge()`:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { merge, object } from "@optique/core/constructs";
import { parseSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";

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
// Dependency source and derived parser in separate objects
const parser = merge(
  object({ mode: option("--mode", modeParser) }),
  object({
    logLevel: option("--log-level", logLevelParser),
    name: option("--name", string()),
  }),
);

// Dependencies are resolved across merged objects
const result = parseSync(parser, [
  "--mode", "prod",
  "--log-level", "warn",
  "--name", "app"
]);
// result.value = { mode: "prod", logLevel: "warn", name: "app" }
~~~~


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

Like `derive()`, `deriveFrom()` also supports async factories. Use
`deriveFromSync()` or `deriveFromAsync()` for explicit mode control:

~~~~ typescript twoslash
import { dependency, deriveFromSync } from "@optique/core/dependency";
import { choice } from "@optique/core/valueparser";

const envParser = dependency(choice(["local", "staging", "production"] as const));
const regionParser = dependency(choice(["us", "eu", "asia"] as const));

// Explicitly sync factory
const serverParser = deriveFromSync({
  metavar: "SERVER",
  dependencies: [envParser, regionParser] as const,
  factory: (env, region) =>
    choice(env === "local"
      ? ["localhost"]
      : [`${env}-${region}-1`, `${env}-${region}-2`]),
  defaultValues: () => ["local", "us"] as const,
});
~~~~


Shell completion support
------------------------

The dependency system integrates with Optique's shell completion. When
generating completions for a derived parser, the system is context-aware:

 -  If the dependency option has already been specified on the command line,
    completions are generated based on that actual value.
 -  If the dependency option hasn't been specified yet, the system uses the
    `defaultValue` to generate reasonable suggestions.

This means users get accurate completions that reflect the current state of
their command line:

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { suggestAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";

const modeParser = dependency(choice(["dev", "prod"] as const));
const portParser = modeParser.derive({
  metavar: "PORT",
  factory: (mode) =>
    choice(mode === "dev" ? ["3000", "8080"] : ["80", "443"]),
  defaultValue: () => "dev" as const,
});

const parser = object({
  mode: option("--mode", modeParser),
  port: option("--port", portParser),
});
// ---cut-before---
// With --mode prod already specified, completions show prod ports
const suggestions = await suggestAsync(parser, ["--mode", "prod", "--port", ""]);
// suggestions include "80" and "443" (prod mode ports)

// Without --mode, completions use defaultValue ("dev")
const defaultSuggestions = await suggestAsync(parser, ["--port", ""]);
// suggestions include "3000" and "8080" (dev mode ports)
~~~~


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
    However, you can have multiple derived parsers that depend on the same
    source, or use `deriveFrom()` to depend on multiple sources simultaneously.

 -  *`deriveFrom()` requires dependency sources*: The `dependencies` array
    in `deriveFrom()` must contain `DependencySource` objects created with
    `dependency()`, not derived parsers. If you need a parser that depends
    on both a source and a derived value, consider restructuring to have
    multiple sources instead.
