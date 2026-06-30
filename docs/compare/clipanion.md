---
description: >-
  How Optique compares to Clipanion—where Yarn's class-based command engine
  excels, and where Optique's composition and fallback chain pull ahead.
---

Optique vs. Clipanion
=====================

[Clipanion] is the command-line engine behind Yarn, and it shows: a powerful
tokenizer, polished help, and an ergonomic class-based command model. Options
are declared as class properties through `Option.*` builders, and types are
inferred from them. The examples here target *Clipanion 4* (currently
`4.0.0-rc.4`; the stable *3.x* line remains widely used, including by Yarn),
running on Node.js.

[Clipanion]: https://mael.dev/clipanion/


At a glance
-----------

A Clipanion command is a class extending `Command`, with options declared as
property initializers (`Option.String('--name')`, `Option.Boolean('--loud')`)
and an async `execute()`. `static paths` defines how the command is invoked.
The property types are inferred from the builders, so commands are strongly
typed. The contrast with Optique is the recurring one between a class model and
a composition of parser values—plus Clipanion's distinctive approach to command
variants.


Mutually exclusive options
--------------------------

Clipanion has no declarative `conflicts` property. Its signature approach is to
register *multiple command classes that share a path*; Clipanion disambiguates
by which options the user supplied. This makes each variant its own
strongly-typed command:

~~~~ typescript
import { Command, Option } from "clipanion";

class PublishFromFile extends Command {
  static paths = [["publish"]];
  file = Option.String("--file", { required: true });
  async execute() {/* file branch */}
}

class PublishFromStdin extends Command {
  static paths = [["publish"]];
  stdin = Option.Boolean("--stdin", { required: true });
  async execute() {/* stdin branch */}
}
~~~~

Alternatively, you can validate within a single command using a Typanion
`static schema`. Either way, the result is enforced at parse time. Optique
expresses the same alternation as one parser whose result type is a
discriminated union, so the branch is known statically:

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

*When each is better.* Clipanion's multiple-command-overload model is genuinely
elegant for command *variants*, and it is battle-tested in Yarn. Optique's
`or()` keeps the alternation inside one parser and gives you a discriminated
union to branch on in ordinary code.


Sharing options across subcommands
----------------------------------

The idiomatic Clipanion pattern is an abstract base `Command` class that
declares the shared options as properties, with concrete commands extending it:

~~~~ typescript
import { Command, Option } from "clipanion";

abstract class BaseCommand extends Command {
  verbose = Option.Boolean("--verbose", false);
  config = Option.String("--config");
}

class Build extends BaseCommand {
  static paths = [["build"]];
  target = Option.String("--target");
  async execute() {/* this.verbose, this.target */}
}

class Deploy extends BaseCommand {
  static paths = [["deploy"]];
  env = Option.String("--env");
  async execute() {/* this.verbose, this.env */}
}
~~~~

This is clean class-based reuse. Optique reuses through composition instead—a
shared `object()` parser merged into each command—so the shared group is a value
rather than a base class:

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

*When each is better.* If you like class inheritance, Clipanion's base-command
pattern is comfortable and well supported. Optique's `merge()` is preferable
when you want shared option groups to be portable values, reusable across
unrelated commands and tools.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

Clipanion options support an environment-variable fallback natively, via the
`env` setting on `Option.String`. Config files and interactive prompts are not
built in, so those layers live in `execute()`:

~~~~ typescript
import { Command, Option } from "clipanion";
import { text } from "@clack/prompts";
import { existsSync, readFileSync } from "node:fs";

class Serve extends Command {
  static paths = [["serve"]];
  host = Option.String("--host", { env: "MYAPP_HOST" });

  async execute() {
    let host = this.host; // CLI arg, then env var (native)
    if (host == null && existsSync("./.myapp.json")) {
      host = JSON.parse(readFileSync("./.myapp.json", "utf-8")).host;
    }
    host ??= String(await text({ message: "Host:" }));
    this.context.stdout.write(`${host}\n`);
  }
}
~~~~

Optique composes the same four layers into a single parser, with priority set by
nesting and the value validated on the way out:

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

*When each is better.* Clipanion's native `env` fallback covers the common case
with no extra packages. Optique pulls ahead when you want the config-file and
prompt layers too, expressed uniformly and with per-value priority.


Beyond the three scenarios
--------------------------

 -  *Dependencies and runtime.* Clipanion has a single dependency (Typanion)
    and targets Node.js; *@optique/core* is zero-dependency and runs on Deno,
    Node.js, and Bun.
 -  *Completion and man pages.* Optique generates completion for five shells
    (with async suggestions) and man pages; Clipanion does neither, though it
    can emit its command definitions as JSON for external tooling to consume.
 -  *Validation.* Clipanion validates with Typanion; Optique uses Standard
    Schema-compatible validators as value parsers, keeps richer Zod and
    Valibot adapters, and validates config files with any Standard Schema
    validator.
 -  *Track record.* Clipanion powers Yarn, a strong real-world endorsement—
    weigh that against v4 still being a release candidate.


When Clipanion is the better choice
-----------------------------------

 -  You want a battle-tested, class-based engine with a powerful tokenizer and
    excellent help, proven at the scale of Yarn.
 -  You like the multiple-command-overload model for command variants.
 -  You are comfortable on the 3.x stable line, or with adopting the 4.x release
    candidate.


When Optique is the better choice
---------------------------------

 -  You want mutually exclusive option groups as discriminated unions within a
    single parser.
 -  You want shared option sets as composable values rather than base classes.
 -  You want environment, config-file, and prompt fallback composed through one
    model.

See *[Why Optique?](../why.md)* for the design philosophy.
