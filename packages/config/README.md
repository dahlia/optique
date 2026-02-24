@optique/config
===============

Configuration file support for [Optique] with type-safe validation using
[Standard Schema].

This package enables CLI applications to load default values from configuration
files with proper priority handling: CLI arguments > config file values >
defaults.

[Optique]: https://optique.dev/
[Standard Schema]: https://standardschema.dev/


Installation
------------

~~~~ bash [Deno]
deno add jsr:@optique/config npm:@standard-schema/spec npm:zod
npm  add     @optique/config     @standard-schema/spec     zod
pnpm add     @optique/config     @standard-schema/spec     zod
bun  add     @optique/config     @standard-schema/spec     zod
~~~~


Quick start
-----------

~~~~ typescript
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { runAsync } from "@optique/run";

// 1. Define config schema
const configSchema = z.object({
  host: z.string(),
  port: z.number(),
});

const configContext = createConfigContext({ schema: configSchema });

// 2. Bind parsers to config values
const parser = object({
  config: withDefault(option("--config", string()), "~/.myapp.json"),
  host: bindConfig(option("--host", string()), {
    context: configContext,
    key: "host",
    default: "localhost",
  }),
  port: bindConfig(option("--port", integer()), {
    context: configContext,
    key: "port",
    default: 3000,
  }),
});

// 3. Run with config support via contexts
const result = await runAsync(parser, {
  contexts: [configContext],
  getConfigPath: (parsed) => parsed.config,
  args: process.argv.slice(2),
});

console.log(`Connecting to ${result.host}:${result.port}`);
~~~~

With a config file `~/.myapp.json`:

~~~~ json
{
  "host": "api.example.com",
  "port": 8080
}
~~~~

Running `myapp --host localhost` will use `localhost` from CLI and `8080` from
the config file.


Features
--------

 -  *Type-safe validation* using Standard Schema (Zod, Valibot, ArkType, etc.)
 -  *Priority handling*: CLI > config file > defaults
 -  *Nested config values* with accessor functions
 -  *Custom file formats* with parser functions
 -  *Composable* with other data sources via `SourceContext` interface


Documentation
-------------

For complete documentation, visit <https://optique.dev/integrations/config>.


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
