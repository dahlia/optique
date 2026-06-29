---
description: >-
  How Optique compares to oclif—where Salesforce's full CLI framework with
  plugins and scaffolding fits, and where Optique's lightweight composition fits.
---

Optique vs. oclif
=================

[oclif] is the Open CLI Framework from Salesforce, and it is a different kind of
tool from a parser. It scaffolds projects, discovers commands by file structure,
generates help and README content, and supports a production-grade plugin
system. It powers the Salesforce, Heroku, and Shopify CLIs. The examples here
target *@oclif/core 4* (with the *oclif* generator at 4.23).

Because oclif is a framework rather than a library, the honest comparison is
less “which parses better” and more “do you want a framework at all.” For a
large, extensible CLI product, oclif offers things Optique does not try to. For
a focused tool, its structure can be more than you need.

[oclif]: https://oclif.io/


At a glance
-----------

An oclif command is a class with static `flags`/`args` and an async `run()` that
calls `this.parse()`. Flags infer their types (`Flags.string()` is `string`,
`Flags.integer()` is `number`), so the parsed object is typed. Around that core,
oclif adds the framework layer: file-based command discovery, hooks, plugins,
and generated docs. Optique is just the parsing-and-resolution library; if you
adopt it inside a larger CLI you bring your own command loader.


Mutually exclusive options
--------------------------

This is an area where oclif is genuinely strong. Flags can declare relationships
natively—`exclusive`, `exactlyOne`, and a general `relationships` field:

~~~~ typescript
import { Command, Flags } from "@oclif/core";

export class Pay extends Command {
  static flags = {
    cash: Flags.boolean({ exclusive: ["creditCard"] }),
    creditCard: Flags.boolean({ exclusive: ["cash"] }),
    // or, to require exactly one of a set:
    // cash: Flags.boolean({ exactlyOne: ["cash", "creditCard"] }),
  };

  async run() {
    const { flags } = await this.parse(Pay);
    // oclif rejects --cash --credit-card before run() proceeds.
  }
}
~~~~

For pairwise and “exactly one” relationships between individual flags, oclif's
declarative support is arguably the richest in this comparison. Where it differs
from Optique is mutually exclusive *groups*: oclif's relationships operate
flag-by-flag, and the parsed `flags` type is a single record rather than a
discriminated union, so distinguishing “which branch was chosen” is still a
runtime concern. Optique's `or()` makes the branch part of the type:

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

*When each is better.* For rich, declarative relationships among individual
flags (`exclusive`, `exactlyOne`, dependencies), oclif is excellent out of the
box. Optique is the better fit when whole option groups alternate and you want
the choice reflected as a discriminated union.


Sharing options across subcommands
----------------------------------

oclif's idiom is an abstract `BaseCommand` with `static baseFlags`, extended by
each concrete command:

~~~~ typescript
import { Command, Flags } from "@oclif/core";

abstract class BaseCommand extends Command {
  static baseFlags = {
    verbose: Flags.boolean({ char: "v" }),
    config: Flags.string({ char: "c" }),
  };
}

export class Deploy extends BaseCommand {
  static flags = {
    ...BaseCommand.baseFlags,
    env: Flags.string({ char: "e", required: true }),
  };
  async run() {
    const { flags } = await this.parse(Deploy); // flags: verbose, config, env
  }
}
~~~~

This is clean and idiomatic within a class hierarchy. Optique's equivalent is a
shared `object()` parser merged into each command—composition rather than
inheritance, so the shared group is reusable beyond a single class tree:

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

*When each is better.* If you are already in oclif's class-based world,
`baseFlags` inheritance is the natural choice. Optique's `merge()` is preferable
when you want shared option groups as standalone values, independent of an
inheritance chain.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

oclif flags support environment-variable defaults natively via `env`.
Config-file fallback and prompts are not built into the flag layer, so they go
in `run()`:

~~~~ typescript
import { Command, Flags } from "@oclif/core";
import { text } from "@clack/prompts";
import { existsSync, readFileSync } from "node:fs";

export class Serve extends Command {
  static flags = {
    host: Flags.string({ env: "MYAPP_HOST" }),
  };

  async run() {
    const { flags } = await this.parse(Serve);
    let host = flags.host; // CLI arg, then env var (native)
    if (host == null && existsSync("./.myapp.json")) {
      host = JSON.parse(readFileSync("./.myapp.json", "utf-8")).host;
    }
    host ??= String(await text({ message: "Host:" }));
    this.log(host);
  }
}
~~~~

Optique expresses the whole chain as one composition, so the value is resolved
and validated before your code sees it:

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

*When each is better.* oclif's per-flag `env` is convenient and, combined with
its config directory conventions, covers a lot. Optique pulls ahead when you
want config-file and prompt fallback as uniform, composable layers with
per-value priority.


Beyond the three scenarios
--------------------------

 -  *Footprint.* oclif is a framework: *@oclif/core* brings roughly eighteen
    runtime dependencies and a full project structure. *@optique/core* is a
    zero-dependency library you drop into any structure.
 -  *Completion and man pages.* oclif's autocomplete is an official plugin
    (*@oclif/plugin-autocomplete*: Bash, zsh, PowerShell); Optique's
    completion is built in for five shells (adding fish and Nushell) with
    async suggestions, and Optique also generates man pages.
 -  *Generated docs and plugins.* oclif's biggest advantages live here:
    automatic README generation, a mature plugin system, and scaffolding—none
    of which Optique tries to provide.
 -  *Adoption.* oclif is enterprise-proven behind the Salesforce, Heroku, and
    Shopify CLIs. For a large, extensible CLI product, that track record is
    hard to argue with.


When oclif is the better choice
-------------------------------

 -  You are building a large, extensible CLI product and want a plugin system,
    command scaffolding, and generated help/README out of the box.
 -  You want file-based command discovery and a lifecycle (hooks, `--json`
    output) shared across many commands.
 -  Rich, declarative flag relationships (`exclusive`, `exactlyOne`) cover your
    constraints.


When Optique is the better choice
---------------------------------

 -  You want a lightweight library, not a framework, with minimal startup cost.
 -  You want mutually exclusive option groups as discriminated unions and shared
    options as composable values.
 -  You want env, config-file, and prompt resolution to compose through one
    model.

See *[Why Optique?](../why.md)* for the design philosophy.
