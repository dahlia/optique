---
description: >-
  How Optique compares to Gunshi—where Gunshi's clean declarative configuration
  and plugins fit, and where Optique's typed composition pulls ahead.
---

Optique vs. Gunshi
==================

[Gunshi] is a modern, declarative command-line library with a clean
configuration-object API, good type inference, and a plugin system. You describe
a command with `define()` and run it with `cli()`; arguments are declared as a
plain `args` object and surface as a typed `ctx.values`. The examples here
target *Gunshi 0.35*, which runs on Node.js, Deno, and Bun.

[Gunshi]: https://gunshi.dev/


At a glance
-----------

Gunshi and Optique share a declarative spirit and both infer result types
without a separate types package. The difference is the shape of the
abstraction: Gunshi is configuration-first (an `args` record plus a `run`
handler), while Optique is composition-first (parsers combined into larger
parsers). That shows up most in constraints between options and in multi-source
value resolution.


Mutually exclusive options
--------------------------

Gunshi's `args` are independent declarations, so mutual exclusion is checked
inside the `run` handler:

~~~~ typescript
import { cli, define } from "gunshi";

const command = define({
  name: "io",
  args: {
    file: { type: "string", short: "f" },
    stdin: { type: "boolean", short: "s" },
  },
  run: (ctx) => {
    const { file, stdin } = ctx.values;
    if (file != null && stdin) {
      throw new Error("Cannot use both --file and --stdin.");
    }
  },
});

await cli(process.argv.slice(2), command);
~~~~

The constraint is runtime logic, and `ctx.values` still types both fields as
present. Optique lifts the same constraint into the parser, where the result is
a discriminated union and the bad combination is unrepresentable:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const fromFile = object({
  source: constant("file"),
  file: option("--file", string()),
});

const fromStdin = object({
  source: constant("stdin"),
  stdin: option("--stdin"),
});

const parser = or(fromFile, fromStdin);
type Value = InferValue<typeof parser>;
//   ^?











// `Value` is a discriminated union: exactly one of the branches
// above, never a mix.
~~~~

*When each is better.* Gunshi's in-handler check is simple and readable for one
or two constraints. Optique's `or()` is the better fit when alternatives are
whole groups and you want the type to encode the choice.


Sharing options across subcommands
----------------------------------

Gunshi registers subcommands through the `subCommands` option of `cli()`. There
is no built-in shared-options feature, but because `args` is a plain object you
can spread a common record into each command:

~~~~ typescript
import { cli, define } from "gunshi";

const commonArgs = {
  verbose: { type: "boolean", short: "v" },
  config: { type: "string", short: "c" },
} as const;

const build = define({
  name: "build",
  args: { ...commonArgs, target: { type: "string" } },
  run: (ctx) => {/* ctx.values.verbose, ctx.values.target */},
});

const deploy = define({
  name: "deploy",
  args: { ...commonArgs, env: { type: "string" } },
  run: (ctx) => {/* ... */},
});

const main = define({ name: "app", run: () => {} });

await cli(process.argv.slice(2), main, {
  name: "app",
  subCommands: { build, deploy },
});
~~~~

The spread works, but the shared record is loose data with no behavior. Optique
merges a real `object()` parser into each command, tracking the combined type:

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

*When each is better.* Gunshi's spread is light and idiomatic for plain data,
and its plugin system can carry cross-cutting behavior. Optique is preferable
when you want the shared group itself to be a composable, validating parser.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

Gunshi's core focuses on parsing declared arguments; environment variables,
config files, and interactive prompts are not part of the `args` model, so the
fallback chain is assembled in the handler:

~~~~ typescript
import { cli, define } from "gunshi";
import { text } from "@clack/prompts";
import { readFileSync } from "node:fs";

const command = define({
  name: "app",
  args: { host: { type: "string" } },
  run: async (ctx) => {
    let host = ctx.values.host;
    if (host == null) host = process.env.MYAPP_HOST;
    if (host == null) {
      try { host = JSON.parse(readFileSync("./.myapp.json", "utf-8")).host; }
      catch { /* no config file */ }
    }
    if (host == null) host = String(await text({ message: "Host:" }));
    console.log(host);
  },
});

await cli(process.argv.slice(2), command);
~~~~

Optique expresses the same cascade as a single parser composition, with priority
set by nesting and the value arriving typed and validated:

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

*When each is better.* Gunshi keeps its core lean and lets you (or a plugin)
decide how values are resolved. Optique is the better fit when multi-source
resolution is a first-class concern you want the library to own.


Beyond the three scenarios
--------------------------

 -  *Dependencies.* Both cores are zero-dependency. Gunshi's completion lives
    in an official plugin (*@gunshi/plugin-completion*, Bash and zsh);
    Optique's completion is built in and spans five shells with async
    suggestions.
 -  *Man pages and schema.* Optique generates man pages (*@optique/man*), uses
    Standard Schema-compatible validators as value parsers, keeps richer Zod
    and Valibot adapters, and validates config files with any Standard Schema
    validator; Gunshi does neither.
 -  *Plugin system.* Gunshi's plugin architecture and lazy-loaded subcommands
    are a genuine strength for larger, modular CLIs.
 -  *Maturity.* Both are relatively young and still building out adoption.


When Gunshi is the better choice
--------------------------------

 -  You want a clean, declarative configuration API with good inference and a
    plugin system for extensibility.
 -  You like lazy-loaded subcommands and a minimal, modern core.
 -  Your constraints and value resolution are simple enough to keep in the
    handler (or a plugin).


When Optique is the better choice
---------------------------------

 -  You want mutually exclusive option groups encoded as a discriminated union.
 -  You want shared option sets as composable, validating parsers.
 -  You want environment, config-file, and prompt fallback handled uniformly by
    the library.

See *[Why Optique?](../why.md)* for the design philosophy.
