---
description: >-
  How Optique compares to Commander.js—where Commander.js's mature, imperative
  builder API shines, and where Optique's composable parsers pull ahead.
---

Optique vs. Commander.js
========================

[Commander.js] is the most widely used command-line framework in the Node.js
ecosystem, and for good reason. Its fluent, imperative builder API is familiar,
well documented, and battle-tested across tools like Vue CLI and countless
internal scripts. If you have written a Node.js CLI before, you have almost
certainly written Commander.js.

The comparison here is against *Commander.js 15* (the current major release).
The goal is not to argue that Optique is better in every situation—Commander.js
is an excellent default for a lot of tools—but to show concretely how the two
libraries diverge once a CLI grows past a flat list of flags.

[Commander.js]: https://github.com/tj/commander.js


At a glance
-----------

Commander.js builds a command object imperatively: you call `.option()`,
`.argument()`, and `.action()` and Commander.js mutates a `Command` instance.
Result types are available through the optional [`@commander-js/extra-typings`]
package, which infers the `.opts()` shape from the chain. Optique instead
treats a parser as a value you compose from smaller parsers, and infers the
result type directly from that structure with no extra package.

The practical difference shows up in three places: expressing constraints
*between* options, sharing option sets across subcommands, and resolving a
value from more than one source. The rest of this page walks through each.

[`@commander-js/extra-typings`]: https://github.com/commander-js/extra-typings


Mutually exclusive option groups
--------------------------------

For the simple case—two individual flags that cannot be used
together—Commander.js has a clean, native answer in `Option.conflicts()`:

~~~~ typescript
import { Command, Option } from "commander";

const program = new Command();

program
  .addOption(new Option("--cash", "pay with cash").conflicts("creditCard"))
  .addOption(new Option("--credit-card", "pay with a credit card"))
  .action((options) => {
    console.log("Payment:", options);
  });

program.parse();
~~~~

This is genuinely good ergonomics for pairwise exclusivity, and Commander.js
even checks conflicts against values coming from environment variables. If your
constraint is “not both of these two flags,” Commander.js handles it
declaratively.

Where it gets harder is mutually exclusive *groups*, where each branch carries
several options that belong together. `conflicts()` works flag-by-flag, so a
group constraint such as “either all three auth flags, or all three config
flags, but never a mix” turns into manual validation in the action callback:

~~~~ typescript
program.action((options) => {
  const hasAuth = options.authToken && options.authKey && options.authSecret;
  const hasConfig = options.configFile && options.configHost;
  if (hasAuth && hasConfig) throw new Error("Cannot mix auth and config flags.");
  if (!hasAuth && !hasConfig) throw new Error("Provide auth or config flags.");
  // ...and the result type still includes every field as possibly-undefined.
});
~~~~

Optique encodes the same constraint in the parser structure with `or()`, and
the inferred type becomes a discriminated union, so the branches cannot be
mixed and each branch only exposes its own fields:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const auth = object({
  mode: constant("auth"),
  token: option("--auth-token", string()),
  key: option("--auth-key", string()),
  secret: option("--auth-secret", string()),
});

const config = object({
  mode: constant("config"),
  file: option("--config-file", string()),
  host: option("--config-host", string()),
  port: option("--config-port", integer()),
});

const parser = or(auth, config);
type Value = InferValue<typeof parser>;
//   ^?















// `Value` is a discriminated union: exactly one of the branches
// above, never a mix.
~~~~

*When each is better.* Reach for Commander.js's `conflicts()` when the
relationship is a handful of pairwise flag conflicts—it is declarative and
reads well. Reach for Optique's `or()` when whole groups are mutually
exclusive, when each branch requires its own options, or when you want the
result type to reflect the constraint so downstream code can `switch` on it
safely.


Sharing options across subcommands
----------------------------------

Commander.js has two idioms here. Global options declared on the parent are
readable from subcommands via `optsWithGlobals()`, and for reusable *local*
options you write a helper function that applies `.option()` calls to a command:

~~~~ typescript
import { Command } from "commander";

function withCommonOptions(cmd: Command): Command {
  return cmd
    .option("-v, --verbose", "verbose output")
    .option("-c, --config <path>", "config file");
}

const program = new Command();
withCommonOptions(program.command("build")).action((opts) => {/* ... */});
withCommonOptions(program.command("deploy")).action((opts) => {/* ... */});

program.parse();
~~~~

This works, but the shared set is a side-effecting function rather than a value,
and `@commander-js/extra-typings` cannot always track the merged option types
through the helper. Optique models the shared set as an ordinary `object()`
parser and folds it into each command with `merge()`, preserving the inferred
type on both sides:

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

*When each is better.* Commander.js's helper-function approach is perfectly
serviceable and keeps you in a familiar imperative style. Optique's `merge()`
is worth it when you want the shared group to be a first-class, independently
testable value, reused across tools, with the merged types tracked
automatically.


CLI args, then env vars, then a config file, then a prompt
----------------------------------------------------------

Commander.js covers the first two layers of this chain natively. An option can
read from an environment variable with `Option.env()`, and
`getOptionValueSource()` tells you where each value came from:

~~~~ typescript
import { Command, Option } from "commander";

const program = new Command()
  .addOption(new Option("--host <host>", "server host").env("MYAPP_HOST"));

program.parse();
~~~~

Config files and interactive prompts are not part of Commander.js, so the last
two layers become hand-written glue: read and parse a file yourself, then fall
back to a prompt library such as [`@clack/prompts`] or [`@inquirer/prompts`]
inside the action. Each layer is wired by hand, and the ordering logic lives in
your business code.

Optique treats every layer as a parser wrapper, so the whole chain is one
composition and the priority is just the nesting order:

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

*When each is better.* If you only need env-var fallback, Commander.js's
built-in `.env()` is simpler and adds no dependencies. Optique pulls ahead when
you want the full resolution lifecycle—env, config file, and prompt—handled
uniformly, where adding or reordering a layer is a change to the composition
rather than to the code that uses the value.

[`@clack/prompts`]: https://github.com/bombshell-dev/clack
[`@inquirer/prompts`]: https://github.com/SBoudrias/Inquirer.js


Beyond the three scenarios
--------------------------

 -  *Dependencies.* Both are lean: Commander.js and *@optique/core* each ship
    with zero runtime dependencies, so neither has an edge here.
 -  *Help, completion, and man pages.* Commander.js generates `--help`, but
    shell completion needs a third-party package and there is no man-page
    support. Optique drives `--help`, completion for five shells, and man
    pages (via *@optique/man*) from the one parser definition.
 -  *Schema validation.* Optique can use any Standard Schema-compatible
    validator as a value parser, keeps richer Zod and Valibot adapters, and
    validates config files with any Standard Schema validator; Commander.js
    leaves value validation to you (the Commander.js + Zod pairing is a
    community pattern, not built in).
 -  *Maturity.* This is Commander.js's strongest card: it has been around
    since the early 2010s, is one of the most-downloaded packages on npm, and
    has examples for nearly every situation. Optique is far younger.


When Commander.js is the better choice
--------------------------------------

 -  You want the most widely known Node.js CLI API, with abundant examples and
    Stack Overflow answers.
 -  Your CLI is mostly a flat set of flags and a few subcommands, and pairwise
    `conflicts()` covers your constraints.
 -  You value an imperative, incremental builder style and a huge ecosystem of
    plugins and integrations.


When Optique is the better choice
---------------------------------

 -  You have mutually exclusive option *groups* and want them enforced by the
    type system, not by runtime checks.
 -  You want to share and recompose option sets as first-class values across
    several commands or tools.
 -  You want CLI, environment, config-file, and prompt resolution to compose
    through one model instead of bespoke glue.

See *[Why Optique?](../why.md)* for the design philosophy behind these
differences.
