---
description: >-
  How Optique compares to cmd-ts—two type-first parsers with similar goals, and
  where their composition models and built-in fallbacks differ.
---

Optique vs. cmd-ts
==================

[cmd-ts] is the closest neighbor to Optique in this comparison: a type-first,
composable argument parser inspired by Rust's [clap]/structopt, with
first-class TypeScript inference and no separate types package. If you like the
idea of building a CLI from small typed pieces, cmd-ts and Optique will both
feel natural. The examples here target *cmd-ts 0.15*, which runs on Node.js,
Deno, and Bun.

[cmd-ts]: https://cmd-ts.vercel.app/
[clap]: https://docs.rs/clap/


At a glance
-----------

Both libraries compose a CLI from typed building blocks and infer the result
type automatically. The differences are in two areas: how mutually exclusive
alternatives are expressed, and how much of the value-resolution lifecycle
(env, config, prompt) the library handles for you. cmd-ts centers on a powerful
`Type` abstraction for parsing and validating a single value; Optique centers on
combinators that compose whole parsers, including alternation and source
fallbacks.


Mutually exclusive options
--------------------------

cmd-ts does not have a declarative conflict or alternation combinator at the
options level, so mutual exclusion is validated inside the handler (or folded
into a custom `Type` for a single value):

~~~~ typescript
import { command, run, flag } from "cmd-ts";

const app = command({
  name: "pay",
  args: {
    cash: flag({ long: "cash" }),
    card: flag({ long: "card" }),
  },
  handler: ({ cash, card }) => {
    if (cash && card) throw new Error("Cannot use both --cash and --card.");
    // ...
  },
});

run(app, process.argv.slice(2));
~~~~

Optique provides `or()` as a structural combinator, so the two branches become a
discriminated union and the invalid combination cannot be constructed:

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

*When each is better.* For a single value drawn from a closed set, cmd-ts's
custom `Type` is elegant and gives great error messages. For alternation between
*groups* of options, Optique's `or()` expresses the constraint directly and
yields a discriminated union for free.


Sharing options across subcommands
----------------------------------

Both libraries handle this with composition. In cmd-ts you define an `args`
object once and spread it into each command:

~~~~ typescript
import { command, subcommands, run, option, flag, string } from "cmd-ts";

const commonArgs = {
  verbose: flag({ long: "verbose" }),
  config: option({ long: "config", type: string }),
};

const build = command({
  name: "build",
  args: { ...commonArgs, target: option({ long: "target", type: string }) },
  handler: (args) => {/* ... */},
});

const deploy = command({
  name: "deploy",
  args: { ...commonArgs, env: option({ long: "env", type: string }) },
  handler: (args) => {/* ... */},
});

run(subcommands({ name: "app", cmds: { build, deploy } }), process.argv.slice(2));
~~~~

Optique does the same with `merge()`. The difference is mostly stylistic—cmd-ts
spreads a plain `args` record, Optique merges `object()` parsers:

~~~~ typescript twoslash
import { merge, object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const common = object({
  verbose: option("--verbose"),
  config: option("--config", string()),
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

*When each is better.* This is close to a tie. cmd-ts's record spread is a touch
more familiar to plain-TypeScript eyes; Optique's `merge()` keeps the shared set
a true parser so the same value can carry validation and recompose elsewhere.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

cmd-ts has no built-in env, config-file, or prompt support, but its `Type`
abstraction gives a clean place to put fallback logic: a custom type can read
the env var, the config file, and prompt, all behind one parser:

~~~~ typescript
import { command, run, option, Type } from "cmd-ts";
import { text } from "@clack/prompts";
import { readFileSync } from "node:fs";

const HostFromAnywhere: Type<string, string> = {
  async from(cliValue) {
    if (cliValue) return cliValue;
    if (process.env.MYAPP_HOST) return process.env.MYAPP_HOST;
    try {
      return JSON.parse(readFileSync("./.myapp.json", "utf-8")).host;
    } catch { /* no config */ }
    return String(await text({ message: "Host:" }));
  },
};

const app = command({
  name: "app",
  args: { host: option({ long: "host", type: HostFromAnywhere }) },
  handler: ({ host }) => console.log(host),
});

run(app, process.argv.slice(2));
~~~~

This is genuinely tidy—the fallback is encapsulated and reusable. The trade-off
is that you write and maintain the cascade yourself, and each layer (env naming,
config path resolution, prompt behavior) is bespoke. Optique ships those layers
as composable wrappers, so the same chain is assembled from packages rather than
hand-written, with priority determined by nesting:

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

*When each is better.* If you want a single, self-contained custom type that
encapsulates a value's resolution and you do not mind writing it, cmd-ts's
`Type` is a clean home for it. Optique is preferable when you want env, config,
and prompt as ready-made, individually-validated layers with the priority order
expressed by composition. The config and env layers also re-validate fallback
values against the inner parser's constraints, which a hand-written `Type` would
need to replicate.


Beyond the three scenarios
--------------------------

 -  *Dependencies.* cmd-ts pulls in a few runtime dependencies;
    *@optique/core* has none.
 -  *Completion and man pages.* cmd-ts has neither; Optique generates
    completion for five shells (with async suggestions) and man pages.
 -  *Validation abstraction.* Both are type-first but validate differently:
    cmd-ts centers on its own `Type` abstraction, while Optique uses Standard
    Schema-compatible validators as value parsers, keeps richer Zod and
    Valibot adapters, and validates config files with any Standard Schema
    validator.
 -  *Maturity.* Both are niche, type-first libraries with smaller communities
    than the mainstream builders.


When cmd-ts is the better choice
--------------------------------

 -  You want a type-first parser with an especially clean abstraction for
    parsing and validating individual values (`Type`).
 -  You like encapsulating per-value resolution logic in one custom type.
 -  Your CLI's constraints are mostly about value validation rather than
    group-level alternation.


When Optique is the better choice
---------------------------------

 -  You want `or()` for mutually exclusive option groups with a discriminated
    union result.
 -  You want environment, config-file, and prompt fallback as composable,
    re-validating layers instead of hand-written logic.
 -  You want one model that also generates help, shell completion, and man pages
    from the same parser.

See *[Why Optique?](../why.md)* for the design philosophy.
