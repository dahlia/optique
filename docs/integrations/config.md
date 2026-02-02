---
description: >-
  Load configuration files with type-safe validation using Standard Schema
  compatible libraries like Zod, Valibot, and ArkType.
---

Config file support
===================

*This API is available since Optique 0.10.0.*

The *@optique/config* package provides configuration file support for Optique,
enabling CLI applications to load default values from configuration files with
proper priority handling: CLI arguments > config file values > defaults.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/config npm:@standard-schema/spec npm:zod
~~~~

~~~~ bash [npm]
npm add @optique/config @standard-schema/spec zod
~~~~

~~~~ bash [pnpm]
pnpm add @optique/config @standard-schema/spec zod
~~~~

~~~~ bash [Yarn]
yarn add @optique/config @standard-schema/spec zod
~~~~

~~~~ bash [Bun]
bun add @optique/config @standard-schema/spec zod
~~~~

:::


Why config files?
-----------------

Many CLI applications need configuration files for:

 -  **Default values** that persist across invocations
 -  **Environment-specific** settings (development, staging, production)
 -  **Complex options** that are tedious to specify on the command line
 -  **Shared settings** across team members (via version control)

The *@optique/config* package handles this pattern with full type safety,
automatic validation, and seamless integration with Optique parsers.


Basic usage
-----------

### 1. Create a config context

Define your configuration schema using any [Standard Schema]-compatible library:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext } from "@optique/config";

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
  verbose: z.boolean().optional(),
});

const configContext = createConfigContext({ schema: configSchema });
~~~~

[Standard Schema]: https://standardschema.dev/

### 2. Bind parsers to config values

Use `bindConfig()` to create parsers that fall back to configuration file
values:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
const configContext = createConfigContext({ schema: z.object({ host: z.string(), port: z.number() }) });
// ---cut-before---
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const hostParser = bindConfig(option("--host", string()), {
  context: configContext,
  key: "host",
  default: "localhost",
});

const portParser = bindConfig(option("--port", integer()), {
  context: configContext,
  key: "port",
  default: 3000,
});
~~~~

### 3. Run with config file

Use `runWithConfig()` to automatically load and validate configuration:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
});

const configContext = createConfigContext({ schema: configSchema });

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
// ---cut-before---
import { runWithConfig } from "@optique/config/run";

const result = await runWithConfig(parser, configContext, {
  getConfigPath: (parsed) => parsed.config,
  args: process.argv.slice(2),
});

console.log(`Connecting to ${result.host}:${result.port}`);
~~~~

If the config file `~/.myapp.json` contains:

~~~~ json
{
  "host": "api.example.com",
  "port": 8080
}
~~~~

And the user runs:

~~~~ bash
myapp --host localhost
~~~~

The result will be:

 -  `host`: `"localhost"` (from CLI, overrides config)
 -  `port`: `8080` (from config file)


Priority order
--------------

Values are resolved in this priority order:

1.  *CLI argument*: Highest priority, always used when provided
2.  *Config file value*: Used when CLI argument not provided
3.  *Default value*: Used when neither CLI nor config provides a value
4.  *Error*: If no value is available and no default is specified

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
const configContext = createConfigContext({ schema: z.object({ port: z.number() }) });
// ---cut-before---
import { option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";

// With default: always succeeds
const portWithDefault = bindConfig(option("--port", integer()), {
  context: configContext,
  key: "port",
  default: 3000,
});

// Without default: requires CLI or config
const portRequired = bindConfig(option("--port", integer()), {
  context: configContext,
  key: "port",
  // No default - will error if not in CLI or config
});
~~~~


Nested config values
--------------------

Use accessor functions to extract nested configuration values:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const configSchema = z.object({
  server: z.object({
    host: z.string(),
    port: z.number(),
  }),
  database: z.object({
    host: z.string(),
    port: z.number(),
  }),
});

const configContext = createConfigContext({ schema: configSchema });

const serverHost = bindConfig(option("--server-host", string()), {
  context: configContext,
  key: (config) => config.server.host,
  default: "localhost",
});

const dbHost = bindConfig(option("--db-host", string()), {
  context: configContext,
  key: (config) => config.database.host,
  default: "localhost",
});
~~~~

With a config file:

~~~~ json
{
  "server": {
    "host": "api.example.com",
    "port": 8080
  },
  "database": {
    "host": "db.example.com",
    "port": 5432
  }
}
~~~~


Custom file formats
-------------------

By default, *@optique/config* parses JSON files. You can provide a custom
file parser for other formats:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
});

const configContext = createConfigContext({ schema: configSchema });

// Custom parser for KEY=VALUE format
const customParser = (contents: Uint8Array): unknown => {
  const text = new TextDecoder().decode(contents);
  const lines = text.split("\n");
  const result: Record<string, string | number> = {};

  for (const line of lines) {
    const [key, value] = line.split("=");
    if (key && value) {
      result[key] = key === "port" ? parseInt(value, 10) : value;
    }
  }

  return result;
};

const parser = object({
  config: option("--config", string()),
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

// Pass fileParser to runWithConfig
const result = await runWithConfig(parser, configContext, {
  getConfigPath: (parsed) => parsed.config,
  fileParser: customParser,
  args: process.argv.slice(2),
});
~~~~

Now your application can read files in the custom KEY=VALUE format:

~~~~
host=api.example.com
port=8080
~~~~


Multi-file configuration
------------------------

For advanced scenarios like hierarchical config merging (system → user →
project), use the `load` callback:

~~~~ typescript twoslash
// @noErrors
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { readFile } from "node:fs/promises";
declare function deepMerge(...objects: any[]): any;

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
  timeout: z.number().optional(),
});

const configContext = createConfigContext({ schema: configSchema });

const parser = object({
  config: option("--config", string()).optional(),
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

const result = await runWithConfig(parser, configContext, {
  load: async (parsed) => {
    // Load multiple config files with different error handling
    const tryLoad = async (path: string) => {
      try {
        return JSON.parse(await readFile(path, "utf-8"));
      } catch {
        return {}; // Silent skip on error
      }
    };

    const system = await tryLoad("/etc/myapp/config.json");
    const user = await tryLoad(`${process.env.HOME}/.config/myapp/config.json`);
    const project = await tryLoad("./.myapp.json");

    // Load custom config file if specified (throws on error)
    const custom = parsed.config
      ? JSON.parse(await readFile(parsed.config, "utf-8"))
      : {};

    // Merge with priority: custom > project > user > system
    return deepMerge(system, user, project, custom);
  },
  args: process.argv.slice(2),
});
~~~~

This approach gives you full control over:

 -  File discovery and loading order
 -  Error handling policies (silent skip vs. hard error)
 -  Merging strategies (deep merge, shallow merge, array concatenation, etc.)
 -  File formats (JSON, TOML, YAML, etc.)

You'll need to provide your own merge utility (e.g., from
[lodash] or
[es-toolkit]).

[lodash]: https://lodash.com/docs#merge
[es-toolkit]: https://es-toolkit.slash.page/reference/object/merge.html


Standard Schema support
-----------------------

The *@optique/config* package uses [Standard Schema], which means it works
with any compatible validation library:

### Zod

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext } from "@optique/config";

const configContext = createConfigContext({
  schema: z.object({
    apiKey: z.string().min(32),
    timeout: z.number().positive(),
  }),
});
~~~~

### Valibot

~~~~ typescript twoslash
import * as v from "valibot";
import { createConfigContext } from "@optique/config";

const configContext = createConfigContext({
  schema: v.object({
    apiKey: v.pipe(v.string(), v.minLength(32)),
    timeout: v.pipe(v.number(), v.minValue(1)),
  }),
});
~~~~

### ArkType

~~~~ typescript twoslash
import { type } from "arktype";
import { createConfigContext } from "@optique/config";

const configContext = createConfigContext({
  schema: type({
    apiKey: "string>=32",
    timeout: "number>0",
  }),
});
~~~~


Composable with other sources
-----------------------------

Config contexts implement the `SourceContext` interface, allowing composition
with other data sources via `runWith()`. When using `ConfigContext` with
`runWith()`, you must provide `getConfigPath` in the options:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
const configContext = createConfigContext({ schema: z.object({ host: z.string() }) });
const parser = object({
  config: option("--config", string()),
  host: bindConfig(option("--host", string()), {
    context: configContext,
    key: "host",
    default: "localhost",
  }),
});
// ---cut-before---
import { runWith } from "@optique/core/facade";

// Combine config with other sources (e.g., environment variables)
// getConfigPath is required when using ConfigContext with runWith()
const result = await runWith(parser, "myapp", [configContext], {
  args: process.argv.slice(2),
  getConfigPath: (parsed) => parsed.config,  // Typed from parser result!
});
~~~~

The `getConfigPath` callback is fully typed based on the parser's result type,
providing type safety without manual type assertions.


Error handling
--------------

### Config file not found

If the config file is not found, *@optique/config* continues with default
values:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { runWithConfig } from "@optique/config/run";

const configContext = createConfigContext({
  schema: z.object({ host: z.string() }),
});

const parser = object({
  config: option("--config", string()),
  host: bindConfig(option("--host", string()), {
    context: configContext,
    key: "host",
    default: "localhost",
  }),
});

// Config file not found or not specified - uses default
const result = await runWithConfig(parser, configContext, {
  getConfigPath: (parsed) => parsed.config,
  args: [],
});

console.log(result.host); // "localhost" (default)
~~~~

### Invalid config file

If the config file fails validation, an error is thrown:

~~~~ typescript twoslash
// @errors: 2304
const configContext = {} as any;
const parser = {} as any;
// ---cut-before---
import { runWithConfig } from "@optique/config/run";

try {
  const result = await runWithConfig(parser, configContext, {
    getConfigPath: (parsed) => "/path/to/invalid-config.json",
    args: [],
  });
} catch (error) {
  console.error("Config validation failed:", error);
}
~~~~


API reference
-------------

### `createConfigContext(options)`

Creates a configuration context.

Parameters
:    -  `options.schema`: Standard Schema validator for the config file

Returns
:   `ConfigContext<T>` implementing `SourceContext` interface

### `bindConfig(parser, options)`

Binds a parser to configuration values with fallback priority.

Parameters
:    -  `parser`: The parser to bind
     -  `options.context`: Config context to use
     -  `options.key`: Property key or accessor function to extract value from
        config
     -  `options.default`: Optional default value

Returns
:   A new parser with config fallback behavior

### `runWithConfig(parser, context, options)`

Runs a parser with config file support using two-pass parsing.

This function accepts either `SingleFileOptions` or `CustomLoadOptions`.

Parameters
:    -  `parser`: The parser to execute
     -  `context`: Config context with schema
     -  `options`: Either single-file or custom load options
     -  `options.args`: Command-line arguments to parse (both modes)

**Single-file mode** (`SingleFileOptions`):
:    -  `options.getConfigPath`: Function to extract config file path from
        parsed result
     -  `options.fileParser`: Optional custom parser for file contents
        (defaults to JSON.parse)

**Custom load mode** (`CustomLoadOptions`):
:    -  `options.load`: Function that receives parsed result and returns config
        data (or Promise of it). Allows full control over multi-file loading,
        merging, and error handling.

Returns
:   `Promise<TValue>` with the parsed result

### `configKey`

Symbol key used to store config data in annotations.


Limitations
-----------

 -  *File I/O is async* — `runWithConfig()` always returns a Promise due to
    file reading
 -  *JSON only by default* — Other formats require the `fileParser` option
    (single-file mode) or custom loading logic (custom load mode)
 -  *Two-pass parsing* — Parsing happens twice (once to extract config path,
    once with config data), which has a performance cost
 -  *Standard Schema required* — You must use a Standard Schema-compatible
    validation library
 -  *No built-in merge utilities* — Multi-file merging requires bringing your
    own merge function (e.g., from lodash or es-toolkit)


Example application
-------------------

Here's a complete example of a CLI application with config file support:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { runWithConfig } from "@optique/config/run";
import { object } from "@optique/core/constructs";
import { option, flag } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";

// Define config schema
const configSchema = z.object({
  host: z.string(),
  port: z.number(),
  verbose: z.boolean().optional(),
  apiKey: z.string(),
});

const configContext = createConfigContext({ schema: configSchema });

// Build parser
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
  verbose: bindConfig(flag("--verbose"), {
    context: configContext,
    key: "verbose",
    default: false,
  }),
  apiKey: bindConfig(option("--api-key", string()), {
    context: configContext,
    key: "apiKey",
    // No default - required from CLI or config
  }),
});

// Run with config support
const config = await runWithConfig(parser, configContext, {
  getConfigPath: (parsed) => parsed.config,
  args: process.argv.slice(2),
});

if (config.verbose) {
  console.log("Configuration:", config);
}

// Use the configuration
console.log(`Connecting to ${config.host}:${config.port}`);
console.log(`API Key: ${config.apiKey.substring(0, 8)}...`);
~~~~

With a config file `~/.myapp.json`:

~~~~ json
{
  "host": "api.example.com",
  "port": 8080,
  "apiKey": "secret-key-12345678"
}
~~~~

Running the application:

~~~~ bash
# Uses all config values
myapp

# Override host from CLI
myapp --host localhost

# Enable verbose mode
myapp --verbose
~~~~

The *@optique/config* package provides a clean, type-safe way to manage
configuration files in your CLI applications while maintaining the flexibility
of command-line arguments.
