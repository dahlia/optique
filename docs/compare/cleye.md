---
description: >-
  How Optique compares to Cleye—where Cleye's tiny, strongly-typed flag parser
  fits, and where Optique's composition and fallback chain pull ahead.
---

Optique vs. Cleye
=================

[Cleye] is a small, focused command-line argument parser with excellent
TypeScript inference. It does one thing well: turn `process.argv` into a typed
`flags`/parameters object with automatically generated `--help`. The examples
here target *Cleye 2.6*, which runs on Node.js.

[Cleye]: https://github.com/privatenumber/cleye


At a glance
-----------

Cleye is configured with a single `cli({ ... })` call describing `flags` and
`parameters`. Flag types are given as constructors (`String`, `Number`,
`Boolean`, or custom functions) and Cleye infers a precise result type. It is a
great choice when you want minimal footprint and strong typing for a flat CLI.
Its scope is deliberately narrow—it parses arguments and stops there—so the
scenarios below are mostly about what Cleye intentionally leaves to you.


Mutually exclusive options
--------------------------

Cleye has no declarative conflict mechanism, so mutual exclusion is a manual
check after parsing:

~~~~ typescript
import { cli } from "cleye";

const argv = cli({
  flags: {
    file: { type: String, alias: "f" },
    stdin: { type: Boolean, alias: "s" },
  },
});

if (argv.flags.file !== undefined && argv.flags.stdin) {
  console.error("Cannot use both --file and --stdin.");
  process.exit(1);
}
~~~~

The check lives in your code, runs at runtime, and the parsed type still allows
both fields to be set at once. Optique expresses the same constraint as parser
structure, so invalid combinations are unrepresentable and the result type is a
discriminated union:

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

*When each is better.* For a one-off script where a single `if` is all you need,
Cleye's manual check is perfectly fine. Optique earns its keep when the
exclusion is structural and you want the types to enforce it.


Sharing options across subcommands
----------------------------------

Cleye supports subcommands via `command()`, but it has no global/shared options
mechanism (a long-standing feature request), so shared flags are duplicated in
each command's `flags` object—or factored into a plain object you spread:

~~~~ typescript
import { cli, command } from "cleye";

const commonFlags = {
  verbose: { type: Boolean, alias: "v" },
  config: { type: String, alias: "c" },
};

const build = command({
  name: "build",
  flags: { ...commonFlags, target: { type: String } },
});

const deploy = command({
  name: "deploy",
  flags: { ...commonFlags, env: { type: String } },
});

cli({ commands: [build, deploy] });
~~~~

The spread keeps things DRY, but the shared set is a loose object literal, not a
parser, so it carries no behavior of its own. Optique's shared group is a real
`object()` parser merged into each command, with the merged type tracked
automatically:

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

*When each is better.* Cleye's object spread is the lighter-weight option when
the shared flags are simple data. Optique is preferable when the shared group
should be a composable, behavior-carrying value.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

Cleye parses `argv` and nothing more: there is no built-in environment-variable,
config-file, or prompt support. The entire fallback chain is hand-written:

~~~~ typescript
import { cli } from "cleye";
import { text } from "@clack/prompts";
import { readFileSync } from "node:fs";

const argv = cli({ flags: { host: { type: String } } });

let host = argv.flags.host;
if (host === undefined) host = process.env.MYAPP_HOST;
if (host === undefined) {
  try {
    host = JSON.parse(readFileSync("./.myapp.json", "utf-8")).host;
  } catch { /* no config file */ }
}
if (host === undefined) host = String(await text({ message: "Host:" }));
~~~~

This is the cascade Optique packages up as a single composition, where priority
is the nesting order and the resolved value is typed:

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

*When each is better.* If all you need is argument parsing and you will handle
configuration yourself, Cleye's minimalism is a feature—nothing to learn beyond
flags. Optique fits when the multi-source resolution is itself a core concern
you would rather not hand-roll.


Beyond the three scenarios
--------------------------

 -  *Footprint and runtime.* Cleye is tiny (two small dependencies) but
    Node.js only; *@optique/core* is zero-dependency and runs on Deno,
    Node.js, and Bun.
 -  *Completion, man pages, schema.* Cleye does one job—parsing argv—so it
    has no completion, man-page, or schema features. Optique generates
    completion for five shells and man pages, integrates Zod and Valibot as
    value parsers, and validates config files with any Standard Schema
    validator.
 -  *Simplicity.* Cleye's single-call API is hard to beat when you just need
    typed flags and good `--help` for a small Node.js script.


When Cleye is the better choice
-------------------------------

 -  You want a tiny dependency that parses arguments with excellent type
    inference and good `--help`, and nothing more.
 -  Your CLI is flat or shallow and you are happy to handle env, config, and
    prompts yourself when you need them.
 -  Minimal footprint and a single-call API matter more than built-in
    constraint or fallback features.


When Optique is the better choice
---------------------------------

 -  You want mutual exclusion and option grouping encoded in the type system.
 -  You want shared option sets as composable parsers rather than duplicated
    literals.
 -  You want environment, config-file, and prompt fallback handled by the
    library instead of bespoke glue.

See *[Why Optique?](../why.md)* for the underlying design.
