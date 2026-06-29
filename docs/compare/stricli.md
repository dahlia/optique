---
description: >-
  How Optique compares to Stricli—where Bloomberg's deliberately minimal,
  no-magic framework fits, and where Optique's richer model pulls ahead.
---

Optique vs. Stricli
===================

[Stricli] is Bloomberg's command-line framework, built around three principles:
commands are just functions, form follows function, and no magic. It is
deliberately minimal, leaning on plain TypeScript objects and functions. Like
*@optique/core*, it ships with zero runtime dependencies, so what distinguishes
the two is philosophy and scope rather than dependency count. The examples here
target *@stricli/core 1.2*, which runs on Node.js, Bun, and Deno.

[Stricli]: https://bloomberg.github.io/stricli/


At a glance
-----------

Stricli describes a command with `buildCommand()`—`docs`, a `parameters` block,
and a `func` handler—and assembles applications with `buildApplication()` and
`buildRouteMap()`. Flag types flow from the `parameters` definition into the
`func` signature, so handlers are strongly typed. Stricli is explicit about what
it leaves out: cross-flag validation, environment fallback, and prompts are all
out of scope by design, delegated to your code or other libraries. That makes
several of the scenarios below a study in what each library chooses to own.


Mutually exclusive options
--------------------------

Stricli's documentation lists conditional/cross-flag validation as out of scope,
so mutual exclusion is a manual check in the handler:

~~~~ typescript
import { buildCommand } from "@stricli/core";

export const config = buildCommand({
  docs: { brief: "Apply configuration." },
  parameters: {
    flags: {
      fromFile: { kind: "parsed", parse: String, brief: "From a file.", optional: true },
      fromEnv: { kind: "parsed", parse: String, brief: "From an env var.", optional: true },
    },
  },
  func(flags: { fromFile?: string; fromEnv?: string }) {
    const set = [flags.fromFile, flags.fromEnv].filter((x) => x !== undefined);
    if (set.length !== 1) throw new Error("Provide exactly one source.");
  },
});
~~~~

Optique encodes the alternative in the parser and gets a discriminated union out
of it, so the constraint is enforced before the handler ever runs:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const fromFile = object({
  source: constant("file"),
  file: option("--from-file", string()),
});

const fromEnv = object({
  source: constant("env"),
  env: option("--from-env", string()),
});

const parser = or(fromFile, fromEnv);
type Value = InferValue<typeof parser>;
//   ^?











// `Value` is a discriminated union: exactly one of the branches
// above, never a mix.
~~~~

*When each is better.* Stricli's no-magic stance means you see exactly what
runs, which some teams prefer. Optique is the better fit when you want the
exclusivity in the type system rather than in a runtime guard.


Sharing options across subcommands
----------------------------------

Stricli has no application-level global flags (a tracked feature request), so
the idiom is to define a flags object and spread it into each command's
parameters:

~~~~ typescript
import { buildCommand, buildRouteMap } from "@stricli/core";

const commonFlags = {
  verbose: { kind: "boolean", brief: "Verbose output.", default: false },
  config: { kind: "parsed", parse: String, brief: "Config path.", optional: true },
} as const;

const build = buildCommand({
  docs: { brief: "Build." },
  parameters: { flags: { ...commonFlags, target: { kind: "parsed", parse: String, brief: "Target." } } },
  func(flags) {/* flags.verbose, flags.target */},
});

const deploy = buildCommand({
  docs: { brief: "Deploy." },
  parameters: { flags: { ...commonFlags, env: { kind: "parsed", parse: String, brief: "Env." } } },
  func(flags) {/* ... */},
});

export const routes = buildRouteMap({ routes: { build, deploy }, docs: { brief: "App." } });
~~~~

Optique merges a real `object()` parser into each command, so the shared group
is a value with its own behavior and inferred type:

~~~~ typescript twoslash
import { merge, object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const common = object({
  verbose: option("-v", "--verbose"),
  config: option("-c", "--config", string()),
});

const build = command("build", merge(common, object({
  action: constant("build"),
  target: option("--target", string()),
})));

const deploy = command("deploy", merge(common, object({
  action: constant("deploy"),
  env: option("--env", string()),
})));

const cli = or(build, deploy);
type Value = InferValue<typeof cli>;
//   ^?

















// `Value` is a discriminated union; the shared `verbose` and `config`
// fields appear on every branch.
~~~~

*When each is better.* Stricli's spread is simple and uses nothing but plain
objects. Optique wins when you want the shared set to be a composable parser
reused across tools.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

Stricli intentionally keeps environment access, config files, and prompts out of
the parsing layer. It encourages dependency injection through a typed `context`
object, but the fallback cascade itself is yours to write:

~~~~ typescript
import { buildCommand } from "@stricli/core";
import { text } from "@clack/prompts";
import { readFileSync } from "node:fs";

export const app = buildCommand({
  docs: { brief: "Run." },
  parameters: { flags: { host: { kind: "parsed", parse: String, brief: "Host.", optional: true } } },
  async func(this: { env: Record<string, string | undefined> }, flags: { host?: string }) {
    let host = flags.host ?? this.env.MYAPP_HOST;
    if (host == null) {
      try { host = JSON.parse(readFileSync("./.myapp.json", "utf-8")).host; }
      catch { /* no config file */ }
    }
    host ??= String(await text({ message: "Host:" }));
    console.log(host);
  },
});
~~~~

Optique provides those layers as composable, individually-validated wrappers,
with priority set by nesting order:

~~~~ typescript
import { z } from "zod";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { bindConfig, createConfigContext } from "@optique/config";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt } from "@optique/clack";
import { run } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({
  schema: z.object({ host: z.string().optional() }),
});

// CLI argument > env var > config file > interactive prompt
const parser = object({
  config: withDefault(option("--config", string()), "~/.myapp.json"),
  host: prompt(
    bindEnv(
      bindConfig(option("--host", string()), {
        context: configContext,
        key: "host",
      }),
      { context: envContext, key: "HOST", parser: string() },
    ),
    { type: "text", message: "Host:", initialValue: "localhost" },
  ),
});

const result = await run(parser, {
  contexts: [envContext, configContext],
  contextOptions: { getConfigPath: (parsed) => parsed.config },
});
~~~~

*When each is better.* Stricli's context-injection model is clean and testable,
and keeping resolution explicit is a deliberate virtue for some teams. Optique
is preferable when you want env, config, and prompt as ready-made layers
instead of writing the cascade per command.


Beyond the three scenarios
--------------------------

 -  *Dependencies.* Both cores are zero-dependency—neither has an edge here.
 -  *Completion and man pages.* Stricli's autocomplete
    (*@stricli/auto-complete*) targets Bash today; Optique's built-in
    completion covers five shells with async, context-aware suggestions, and
    Optique also generates man pages.
 -  *Schema validation.* Optique integrates Zod and Valibot as value parsers
    (and any Standard Schema validator for config); Stricli relies on
    TypeScript's types and leaves runtime validation to you.
 -  *Philosophy.* Stricli's no-magic, dependency-injection model is a
    deliberate strength for teams that want value resolution kept explicit
    and predictable.


When Stricli is the better choice
---------------------------------

 -  You want a no-magic framework where everything is plain functions and
    objects you can debug with standard tools, with an intentionally small API
    surface.
 -  You value lazy-loaded commands, type-safe routing, and shell autocomplete
    via *@stricli/auto-complete*.
 -  You prefer to own value resolution explicitly via dependency injection.


When Optique is the better choice
---------------------------------

 -  You want mutual exclusion and option grouping enforced by the types.
 -  You want shared option sets as composable parsers rather than spread
    records.
 -  You want environment, config-file, and prompt fallback provided and
    validated by the library.

See *[Why Optique?](../why.md)* for the design philosophy.
