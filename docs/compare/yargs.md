---
description: >-
  How Optique compares to Yargs—where Yargs's declarative builder with built-in
  env and config support fits, and where Optique's typed composition pulls ahead.
---

Optique vs. Yargs
=================

[Yargs] is the other giant of the Node.js CLI world. Its declarative builder,
command modules, and middleware pipeline have powered tools for over a decade,
and it ships with conveniences that many parsers leave to add-ons—notably
built-in environment-variable and config-file support.

This page compares against *Yargs 18*. Yargs's strengths are real; the contrast
with Optique is mostly about type inference and how constraints are expressed.

[Yargs]: https://github.com/yargs/yargs


At a glance
-----------

Yargs is configured by chaining `.option()`, `.command()`, and `.middleware()`
calls, with option metadata supplied as plain objects. TypeScript support comes
from the community `@types/yargs` definitions; the parsed `argv` type is widely
inferred but you often annotate handlers or assert shapes for complex commands.
Optique infers the full result type from the parser composition itself, with no
separate type package.


Mutually exclusive options
--------------------------

Yargs supports pairwise exclusivity natively through `conflicts`:

~~~~ typescript
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

yargs(hideBin(process.argv))
  .option("cash", { type: "boolean", conflicts: "creditCard" })
  .option("creditCard", { type: "boolean" })
  .parse();
~~~~

This is convenient, with one well-known wrinkle: because boolean options default
to `false`, `conflicts` between booleans can trigger even when the user set only
one, so the pattern works best with options that are genuinely absent when
unset. As with Commander.js, the harder case is mutually exclusive *groups* of
options, which falls back to manual checks inside the handler—and the parsed
`argv` type still carries every field regardless of which branch was used.

Optique expresses the group constraint in the parser and reflects it in the
type as a discriminated union:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const auth = object({
  mode: constant("auth"),
  token: option("--auth-token", string()),
  key: option("--auth-key", string()),
});

const config = object({
  mode: constant("config"),
  file: option("--config-file", string()),
  port: option("--config-port", integer()),
});

const parser = or(auth, config);
type Value = InferValue<typeof parser>;
//   ^?













// `Value` is a discriminated union: exactly one of the branches
// above, never a mix.
~~~~

*When each is better.* Yargs's `conflicts` is fine for a few mutually exclusive
flags. Optique's `or()` is the better fit when each branch is a group of options
and you want the constraint enforced at the type level.


Sharing options across subcommands
----------------------------------

The idiomatic Yargs approach is a builder helper that applies shared options to
each command's builder, often paired with `.group()` for help output and
`.middleware()` for shared preprocessing:

~~~~ typescript
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";

const common = (y: Argv) =>
  y.option("verbose", { type: "boolean", alias: "v" })
   .option("config", { type: "string", alias: "c" });

yargs(hideBin(process.argv))
  .command("build", "build it", (y) => common(y).option("target", { type: "string" }))
  .command("deploy", "deploy it", (y) => common(y).option("env", { type: "string" }))
  .parse();
~~~~

It is clean, but the shared set is a builder transformation rather than a value,
and the merged types are not always tracked through the helper. Optique's shared
group is an `object()` parser merged into each command, with types preserved:

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

*When each is better.* Yargs's middleware is powerful for cross-cutting behavior
(loading data, transforming args) that goes beyond just sharing option
definitions. Optique wins when you specifically want reusable, typed option
groups composed as values.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

This is where Yargs is unusually well equipped out of the box: it has native
environment-variable parsing via `.env()` and native config-file loading via
`.config()`:

~~~~ typescript
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

yargs(hideBin(process.argv))
  .env("MYAPP")                       // MYAPP_HOST → --host
  .option("host", { type: "string" })
  .config("config", "path to config", (path) =>
    JSON.parse(require("node:fs").readFileSync(path, "utf-8")))
  .parse();
~~~~

So three of the four layers (CLI, env, config) are built in. The remaining
layer—prompting interactively when nothing else supplied a value—is not part of
Yargs; you add it in middleware with an external prompt library. The resolution
order is governed by Yargs's own precedence rules plus your middleware, rather
than something you declare per value.

Optique expresses all four layers as one composition, where nesting order *is*
the precedence:

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

*When each is better.* If you need CLI plus env plus a config file but no
interactive prompting, Yargs gives you that with almost no code. Optique pulls
ahead when prompting is part of the chain, when you want per-value control of
the fallback order, and when the resolved values should stay fully typed.


Beyond the three scenarios
--------------------------

 -  *Dependencies.* Yargs pulls in a handful of runtime dependencies;
    *@optique/core* has none, adding packages only for the integrations you
    actually use.
 -  *Completion and man pages.* Both generate shell completion—Yargs for Bash
    and zsh; Optique for those plus PowerShell and Nushell, with context-aware
    and async suggestions. Only Optique also generates man pages.
 -  *Schema validation.* Optique uses Standard Schema-compatible validators as
    value parsers, keeps richer Zod and Valibot adapters, and validates config
    files with any Standard Schema validator; Yargs has no equivalent.
 -  *Maturity.* Yargs has a decade of adoption and a huge user base that
    Optique cannot match yet—worth weighing if longevity and familiarity
    matter more than the composition model.


When Yargs is the better choice
-------------------------------

 -  You want built-in environment-variable and config-file parsing without
    extra packages.
 -  You like the middleware pipeline for cross-cutting concerns and the
    command-module pattern for splitting large CLIs across files.
 -  Your constraints are simple and you are comfortable annotating types where
    inference falls short.


When Optique is the better choice
---------------------------------

 -  You want option groups and mutual exclusion modeled in the types.
 -  You want the fallback chain—including interactive prompts—expressed
    declaratively and per value.
 -  You want result types inferred from the parser with no separate type
    definitions to maintain.

See *[Why Optique?](../why.md)* for the underlying design.
