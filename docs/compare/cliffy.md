---
description: >-
  How Optique compares to Cliffy—where Cliffy's batteries-included Deno
  framework excels, and where Optique's typed composition pulls ahead.
---

Optique vs. Cliffy
==================

[Cliffy] is a comprehensive command-line framework born in the Deno ecosystem.
Beyond argument parsing it bundles interactive prompts, tables, ANSI helpers,
and more, and it has matured into a polished, batteries-included toolkit. It is
distributed on JSR as *@cliffy/command* (the examples here target *Cliffy 1.2*)
and runs on Deno, Node.js, and Bun.

[Cliffy]: https://cliffy.io/


At a glance
-----------

Cliffy uses a fluent builder much like Commander.js, but with a distinctive
inline type syntax: `--port <port:number>` declares both the option and its
type, and Cliffy infers the action's argument types from those annotations. It
is one of the most feature-complete CLI frameworks available, especially on
Deno. The contrast with Optique is the familiar one between a fluent builder
and a composition of parser values.


Mutually exclusive options
--------------------------

Cliffy supports pairwise exclusivity natively through the `conflicts` option:

~~~~ typescript
import { Command } from "@cliffy/command";

await new Command()
  .option("--file <file:string>", "Read from a file.", { conflicts: ["stdin"] })
  .option("--stdin", "Read from standard input.", { conflicts: ["file"] })
  .action((options) => {
    console.log(options);
  })
  .parse(Deno.args);
~~~~

This is clean for individual flags. As with the other builder libraries, the
case it does not cover declaratively is mutually exclusive *groups*—several
options that must appear together as one alternative—where you drop to manual
checks in the action, and the inferred options type still lists every flag.

Optique models the group alternation directly, producing a discriminated union:

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

*When each is better.* Cliffy's `conflicts` is ergonomic for pairwise flag
conflicts. Optique's `or()` is the better fit for whole-group alternation that
you want reflected in the result type.


Sharing options across subcommands
----------------------------------

Cliffy has first-class support for this through `globalOption`: options declared
as global on a parent command are available to every subcommand.

~~~~ typescript
import { Command } from "@cliffy/command";

await new Command()
  .globalOption("-v, --verbose", "Enable verbose output.")
  .globalOption("-c, --config <file:string>", "Config file path.")
  .command("build", new Command()
    .action((options) => console.log("build", options)))
  .command("deploy", new Command()
    .action((options) => console.log("deploy", options)))
  .parse(Deno.args);
~~~~

This is a genuine convenience—arguably nicer than the helper-function approach
of Commander.js or Yargs—because inheritance is built in. The difference from
Optique is conceptual: Cliffy's globals are inherited through the command tree,
whereas Optique's shared group is a standalone `object()` value you merge
explicitly wherever you want it, which makes the group reusable across unrelated
commands and even across separate tools:

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

*When each is better.* If your sharing need is “all subcommands of this program
see these flags,” Cliffy's `globalOption` is direct and pleasant. Optique's
`merge()` shines when the shared set is a portable value you compose
deliberately rather than inherit implicitly.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

Cliffy covers more of this chain natively than most: it has built-in
environment-variable bindings via `.env()`, and a first-class interactive prompt
module in *@cliffy/prompt*. Config-file fallback is the piece you assemble
yourself.

~~~~ typescript
import { Command } from "@cliffy/command";
import { Input } from "@cliffy/prompt";

await new Command()
  .env("MYAPP_HOST=<host:string>", "Server host.")
  .option("--host <host:string>", "Server host.")
  .action(async (options) => {
    // CLI flag and env var are resolved by Cliffy; prompt is a separate step.
    const host = options.host ?? await Input.prompt({ message: "Host:" });
    console.log(`Using ${host}`);
  })
  .parse(Deno.args);
~~~~

Two of the four layers (CLI, env) are declarative; the prompt is a separate
imperative call in the action, and the config-file layer is manual. Optique
folds all four into one parser where order is priority and the value arrives
already resolved and typed:

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

*When each is better.* Cliffy is a strong pick when you want a single dependency
that already includes prompts, env bindings, and a lot more, especially on Deno.
Optique is the better fit when you want the resolution chain—including the
config file—expressed as one composable, per-value pipeline.


Beyond the three scenarios
--------------------------

 -  *Dependencies and runtimes.* Cliffy is a suite of JSR modules and is
    Deno-first (usable from Node.js and Bun via JSR); *@optique/core* is a
    single zero-dependency package published to both JSR and npm. Both run
    everywhere.
 -  *Completion and man pages.* Both have built-in completion—Cliffy for
    Bash, zsh, and fish; Optique for those plus PowerShell and Nushell, with
    context-aware and async suggestions—and only Optique generates man pages.
 -  *Batteries included.* Cliffy bundles far more than parsing—prompts,
    tables, ANSI helpers, and more—which is a real convenience if you want
    one dependency for a whole Deno CLI.
 -  *Schema validation.* Optique uses Standard Schema-compatible validators as
    value parsers, keeps richer Zod and Valibot adapters, and validates config
    files with any Standard Schema validator; Cliffy does not.


When Cliffy is the better choice
--------------------------------

 -  You are on Deno and want a polished, batteries-included framework (prompts,
    tables, ANSI, and more) from one source.
 -  You like the inline `<name:type>` syntax and built-in `globalOption`
    inheritance.
 -  You want interactive prompts and environment bindings without adding
    separate packages.


When Optique is the better choice
---------------------------------

 -  You want mutually exclusive option groups encoded in the types.
 -  You want shared option sets as portable values rather than tree-inherited
    globals.
 -  You want the env, config-file, and prompt fallback to compose through one
    uniform model.

See *[Why Optique?](../why.md)* for the design philosophy.
