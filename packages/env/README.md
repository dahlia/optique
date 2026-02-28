@optique/env
============

Environment variable support for [Optique].

This package provides a type-safe way to bind CLI parsers to environment
variables with clear fallback behavior:

CLI arguments > environment variables > defaults.

[Optique]: https://optique.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/env
npm add @optique/env
pnpm add @optique/env
yarn add @optique/env
bun add @optique/env
~~~~


Quick start
-----------

~~~~ typescript
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import { bindEnv, bool, createEnvContext } from "@optique/env";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const parser = object({
  host: bindEnv(option("--host", string()), {
    context: envContext,
    key: "HOST",
    parser: string(),
    default: "localhost",
  }),
  port: bindEnv(option("--port", integer()), {
    context: envContext,
    key: "PORT",
    parser: integer(),
    default: 3000,
  }),
  verbose: bindEnv(option("--verbose", bool()), {
    context: envContext,
    key: "VERBOSE",
    parser: bool(),
    default: false,
  }),
});

const result = await runAsync(parser, {
  contexts: [envContext],
});

console.log(result);
~~~~


Features
--------

 -  *Type-safe env parsing* with any Optique `ValueParser`
 -  *Common Boolean parser* via `bool()`
 -  *Prefix support* for namespaced environment variables
 -  *Custom env source* for Deno, tests, and custom runtimes
 -  *Composable contexts* with `run()` / `runAsync()` / `runWith()`


Documentation
-------------

For full documentation, visit <https://optique.dev/integrations/env>.


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
