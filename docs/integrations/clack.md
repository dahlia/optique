---
description: >-
  Add interactive prompts as fallback for missing CLI arguments using Clack.
---

Clack prompts
=============

*This API is available since Optique 1.2.0.*

The *@optique/clack* package wraps any Optique parser with an interactive
[Clack] prompt.  CLI values are used directly; when a value is absent, Clack
asks for it interactively.

Because interactive prompts are asynchronous, the returned parser always has
`mode: "async"`.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/clack
~~~~

~~~~ bash [npm]
npm add @optique/clack
~~~~

~~~~ bash [pnpm]
pnpm add @optique/clack
~~~~

~~~~ bash [Yarn]
yarn add @optique/clack
~~~~

~~~~ bash [Bun]
bun add @optique/clack
~~~~

:::

[Clack]: https://github.com/bombshell-dev/clack


Basic usage
-----------

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";
import { run } from "@optique/run";

const parser = object({
  name: prompt(option("--name", string()), {
    type: "text",
    message: "Project name:",
  }),
  port: prompt(option("--port", integer()), {
    type: "number",
    message: "Port:",
    initialValue: 3000,
  }),
});

await run(parser);
~~~~

When `--name` and `--port` are provided on the command line, prompts are
skipped.  Otherwise Clack asks for the missing values.


Prompt types
------------

`text`
:   Prompts for a string value.  Supports `message`, `placeholder`,
    `initialValue`, and `validate`.

`password`
:   Prompts for a masked string value.  Supports `message`, `mask`, and
    `validate`.

`confirm`
:   Prompts for a Boolean value.  Use with Boolean parsers such as
    `flag("--verbose")`.

`number`
:   Prompts with Clack's text prompt and converts the submitted value to a
    number.  Supports `initialValue`, `min`, `max`, and numeric `validate`.

`select`
:   Prompts for one string value from an `options` list.

`multiselect`
:   Prompts for multiple string values from an `options` list.  Use with
    parsers such as `multiple(option("--tag", string()))`.


Options
-------

Selection prompts accept plain strings or option objects:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const env = prompt(option("--env", string()), {
  type: "select",
  message: "Environment:",
  options: [
    "dev",
    { value: "staging", label: "Staging", hint: "shared" },
    { value: "prod", label: "Production", disabled: true },
  ],
});
~~~~


Cancellation
------------

When Clack reports cancellation through `isCancel()`, *@optique/clack* returns
a parse failure with the message `Prompt cancelled.` instead of throwing.
