@optique/inquirer
=================

[Inquirer.js] prompt support for [Optique].

This package wraps any Optique parser with an interactive prompt that fires
when no CLI value is provided.  The fallback priority is:

CLI arguments > Inquirer.js prompt.

Because interactive prompts are inherently asynchronous, the returned parser
always has `mode: "async"`.

[Inquirer.js]: https://github.com/SBoudrias/Inquirer.js
[Optique]: https://optique.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/inquirer
npm add @optique/inquirer
pnpm add @optique/inquirer
yarn add @optique/inquirer
bun add @optique/inquirer
~~~~


Quick start
-----------

~~~~ typescript
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";
import { run } from "@optique/run";

const parser = object({
  name: prompt(option("--name", string()), {
    type: "input",
    message: "Enter your name:",
  }),
  port: prompt(option("--port", integer()), {
    type: "number",
    message: "Enter the port number:",
    default: 3000,
  }),
});

await run(parser);
~~~~

When `--name` and `--port` are provided on the command line, the prompts are
skipped.  When they are absent, the user sees Inquirer.js prompts.


Features
--------

 -  *Ten prompt types*: `input`, `password`, `number`, `confirm`, `select`,
    `rawlist`, `expand`, `checkbox`, `editor`, and a custom `prompter` for
    testing
 -  *Transparent composition* with `bindEnv()` and `bindConfig()` — the
    prompt fires only when no higher-priority source supplies a value
 -  *Prompt-only values* via `prompt(fail<T>(), …)` when a value should not
    be exposed as a CLI option
 -  *TTY-free testing* via the `prompter` escape hatch on every config type


Documentation
-------------

For full documentation, visit <https://optique.dev/integrations/inquirer>.


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
