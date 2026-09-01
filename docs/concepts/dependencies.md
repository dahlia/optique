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
record their raw input and preliminary result in a shared input trace. After
parsing, Optique builds a shared dependency runtime, resolves dependency
source values, and replays dependent parsers with the actual dependency
values.


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
  mode: "sync",
  factory: (mode) =>
    choice(
      mode === "dev"
        ? ["debug", "info", "warn", "error"]
        : ["warn", "error"]
    ),
  defaultValue: () => "dev" as const,
});
~~~~

The `derive()` method takes an options object with four properties:

`metavar`
:   The metavariable name shown in help text (e.g., `"LEVEL"`).

`mode`
:   The mode of the parser returned by the factory: `"sync"` or `"async"`.
    This determines whether the derived parser is synchronous or asynchronous,
    without calling the factory at construction time.

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
  mode: "async",
  factory: (remote) => gitRemoteBranch({ remote }),
  defaultValue: () => "origin",
});

// branchParser.mode is "async"
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
  mode: "sync",
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

This replay happens automatically during normal `parse*()` and `suggest*()`
flows, whether the parsers appear at the top level or inside combinators like
`object()`, `tuple()`, `merge()`, and `concat()`. You do not need any special
handling beyond using the dependency source and derived parser together.

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
  mode: "sync",
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
  mode: "sync",
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
  mode: "sync",
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
  mode: "sync",
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


Chaining derived dependency sources
-----------------------------------

*This behavior is available since Optique 1.3.0.*

Wrap a derived parser with `dependency()` when later parsers need to depend on
its resolved value. The result keeps both roles: it remains derived from its
upstream source and becomes a source for the next level:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { parseSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";

const frameworkParser = dependency(choice(["fresh", "hono"] as const));

const packageManagerParser = dependency(frameworkParser.deriveSync({
  metavar: "PACKAGE_MANAGER",
  factory: (framework) =>
    choice(framework === "fresh" ? ["deno"] : ["npm"]),
  defaultValue: () => "fresh" as const,
}));

const storageParser = packageManagerParser.deriveSync({
  metavar: "STORAGE",
  factory: (packageManager) =>
    choice(packageManager === "deno" ? ["kv"] : ["redis"]),
  defaultValue: () => "deno" as const,
});

const parser = object({
  // Field order does not determine dependency evaluation order.
  storage: option("--storage", storageParser),
  packageManager: option("--package-manager", packageManagerParser),
  framework: option("--framework", frameworkParser),
});

const result = parseSync(parser, [
  "--framework", "hono",
  "--package-manager", "npm",
  "--storage", "redis",
]);
~~~~

The same composition works when the middle parser was created with
`deriveFrom()` and therefore has several upstream sources. Synchronous and
asynchronous modes continue to combine at each level, so one asynchronous
source or factory makes every downstream parser asynchronous.

Optique resolves a chain in dependency order rather than object/tuple field
order. A derived source publishes only its replayed value; its preliminary
parse result, which may have used an upstream default, is never exposed to the
next level. If an intermediate source is absent without failing, a downstream
parser may use its own `defaultValue`/`defaultValues`. If an upstream value was
provided but failed validation, that failure propagates instead, and the error
includes the affected metavar chain.


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
  mode: "sync",
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
  mode: "sync",
  factory: (remote) => choice(fetchBranches(remote)),
  defaultValue: () => "origin",
});

const pushCommand = object({
  remote: argument(remoteParser),
  branch: argument(branchParser),
  force: option("-f", "--force"),
});
~~~~


Interactive sources
-------------------

*This behavior is available since Optique 1.3.0.*

A dependency source can be wrapped in a prompt fallback such as `prompt()`
from *@optique/inquirer* or *@optique/clack*.  When the command line omits
the source option and the prompt supplies the value interactively, the
prompted value registers as the dependency value, so derived parsers observe
the value the user actually selected:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const modeParser = dependency(choice(["dev", "prod"] as const));

const portParser = modeParser.derive({
  metavar: "PORT",
  mode: "sync",
  factory: (mode) =>
    choice(mode === "dev" ? ["3000", "8080"] : ["80", "443"]),
  defaultValue: () => "dev" as const,
});

const parser = object({
  mode: prompt(option("--mode", modeParser), {
    type: "select",
    message: "Select mode:",
    choices: ["dev", "prod"],
  }),
  port: option("--port", portParser),
});
// With --port 443 and no --mode, the prompt asks for the mode first, and
// the answer determines which ports --port accepts.
~~~~

A derived parser behaves identically whether the dependency value came from
the command line, an environment or configuration binding, or a prompt.
Existing precedence is unchanged: the prompt runs only after the command
line and earlier fallback sources fail to produce a value.

A prompted source and its consumers can live anywhere within the same
`object()`, `tuple()`, `seq()`, `concat()`, or `merge()` composition,
including fields contributed through `merge()` children and sources nested
in child constructs such as `concat()` child tuples.  A prompted source
transformed with `map()` registers its pre-transform value, so consumers
derive from the value the prompt produced rather than the mapped result.
To make its value available before derived parsers re-evaluate, a
dependency-source prompt runs before ordinary prompts, so it may be
displayed before a non-source prompt declared earlier in the same object.
When the user cancels a source prompt, the parse fails immediately and
later prompts do not run.

The relationship also works in the opposite direction: a prompt's own
configuration can be derived from dependency values with
`derivePromptConfig()` from *@optique/prompt* (re-exported by
*@optique/inquirer* and *@optique/clack*).  The resolver receives the
published source values and produces the prompt configuration right
before the prompt runs, so a later question can adapt its choices to
earlier answers:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { derivePromptConfig, prompt } from "@optique/inquirer";

const framework = dependency(choice(["fresh", "hono"] as const));
const packageManager = dependency(choice(["deno", "npm", "pnpm"] as const));
const storage = packageManager.deriveSync({
  metavar: "STORAGE",
  factory: (pm) => choice(pm === "deno" ? ["kv"] : ["redis", "postgres"]),
  defaultValue: () => "deno" as const,
});

const parser = object({
  framework: prompt(option("--framework", framework), {
    type: "select",
    message: "Web framework:",
    choices: ["fresh", "hono"],
  }),
  packageManager: prompt(
    option("--package-manager", packageManager),
    derivePromptConfig(framework, (value) => ({
      type: "select",
      message: "Package manager:",
      choices: value === "fresh" ? ["deno"] : ["npm", "pnpm"],
    })),
  ),
  storage: option("--storage", storage),
});
// The package manager prompt derives its choices from the framework
// answer, and its own answer then determines which storages --storage
// accepts.
~~~~

Such a prompt is a consumer in the dependency graph, and it may be a
source at the same time, as above.  The scheduler runs it only after the
sources its resolver reads have published, whether their values came
from the command line, a binding, or another prompt.  See the
[*@optique/prompt* documentation](../integrations/prompt.md#derived-prompt-configurations)
for resolver defaults, failure behavior, and the runtime condition form.

A source inside a `conditional()` or a `command()` also reaches consumers
declared next to that construct, and it does so whether the value was
typed on the command line or answered interactively: the `conditional()`
discriminator, the fields of the selected branch, and the subtree of a
selected command all register into the enclosing runtime.  When nothing
on the command line selects a branch, the branch chosen by the
discriminator's completion—including a prompted discriminator's answer,
and the default branch when no named branch applies—is resolved once
before derived parsers re-evaluate, and the same selection is reused by
the final completion.  One limitation: a prompted discriminator that
does not wrap a dependency source cannot participate in this early
branch resolution, so sources inside the branch it selects only complete
during the conditional's own completion.


Evaluation order and failures
-----------------------------

Dependency evaluation follows the active source graph. Independent nodes keep
their declaration order, while each source is resolved before the derived
parsers that consume it. This applies equally to `object()` and `tuple()` and
to sources exposed through selected `conditional()`/`command()` branches.

Suggestions use values already present in parser state, plus declared
`defaultValue`/`defaultValues` fallbacks when a source is absent. They never run
prompts, prompt configuration resolvers, or other effectful completions. During
real completion, effectful sources run serially and at most once per parse
operation. Their results and failures are scoped to that operation.

A prompt whose configuration is derived with `derivePromptConfig()` is a
consumer node in the same graph: the sources its resolver reads count as its
providers, so they resolve first, and the prompt runs after them regardless of
field order.  A branch that a `conditional()` selects only during completion
contributes its completion dependencies to the enclosing graph as well: the
conditional waits for the providers its selectable branches read, even when
they are declared after it.  Once the discriminator resolves the selection,
the estimate is replaced by the selected branch's actual dependencies, and a
branch occurrence hides an outer provider only when it will actively publish
the source itself—through a guaranteed completion or default, or a value the
branch already parsed or bound—so an absent `optional()` occurrence or an
unselected nested alternative does not stop a later provider from serving the
branch.

An invalid source never falls back to its default. The failure propagates
through every derived source that consumes it—including prompts whose
configurations read it—and diagnostics show the metavars along that dependency
path. Optique also rejects a cycle in the active runtime graph with the
involved paths/metavars, although ordinary `derive()` and `deriveFrom()`
composition constructs an acyclic graph by value; derived prompt
configurations can introduce cycles, which fail with the same diagnostic.
An apparent cycle whose edges belong to `conditional()` branches that cannot
be selected together is not a real cycle and is not rejected: the judgment is
made against the selected branch's actual providers and consumers.
