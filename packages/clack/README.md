@optique/clack
==============

Interactive prompt support for [Optique] via [Clack].

This package wraps any Optique parser with a Clack prompt that fires when no
CLI value is provided.

[Optique]: https://optique.dev/
[Clack]: https://github.com/bombshell-dev/clack


Installation
------------

~~~~ bash
deno add jsr:@optique/clack
npm add @optique/clack
pnpm add @optique/clack
yarn add @optique/clack
bun add @optique/clack
~~~~


Documentation
-------------

For full documentation, visit <https://optique.dev/integrations/clack>.


Quick start
-----------

~~~~ typescript
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


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
