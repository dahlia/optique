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

 -  *Default values* that persist across invocations
 -  *Environment-specific* settings (development, staging, production)
 -  *Complex options* that are tedious to specify on the command line
 -  *Shared settings* across team members (via version control)

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

### 3. Run with config support

Pass the config context to `runAsync()` (or `run()`) via the `contexts` option:

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
import { runAsync } from "@optique/run";

const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
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


Help, version, and completion
-----------------------------

When using `run()` or `runAsync()` with config contexts, help messages,
version display, and shell completion generation all work seamlessly.
Genuine help, version, and completion requests work even when
configuration files are missing or invalid, ensuring users can still
access those features unless the user parser already consumes the same
token sequence as ordinary data:

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
import { runAsync } from "@optique/run";

const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
  help: "option",
  version: "1.0.0",
  completion: "option",
});
~~~~

Now users can use:

~~~~ bash
# Show help (even if config file is missing)
myapp --help

# Show version
myapp --version

# Generate shell completion
myapp --completion bash > myapp-completion.sh
~~~~

The key benefit is that genuine help, version, and completion requests
work *before* config file loading, so they succeed even when the config
file is invalid or missing.  If the parser accepts the same tokens as
ordinary input, parsing takes precedence and config loading proceeds as
usual.


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


Resolving paths relative to config files
----------------------------------------

For path-like options, CLI values and config values often need different base
directories:

 -  CLI values are usually interpreted relative to the current working
    directory
 -  Config values are usually interpreted relative to the config file location

`bindConfig()` key callbacks receive metadata as a second argument, so you can
resolve config-relative paths reliably.

~~~~ typescript twoslash
import { resolve } from "node:path";
import { z } from "zod";
import { bindConfig, createConfigContext } from "@optique/config";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { map } from "@optique/core/modifiers";

const configContext = createConfigContext({
  schema: z.object({
    outDir: z.string(),
  }),
});

const parser = bindConfig(
  map(option("--out-dir", string()), (value) => resolve(process.cwd(), value)),
  {
    context: configContext,
    key: (config, meta) => {
      if (meta === undefined) {
        throw new TypeError("Config metadata is not available.");
      }

      return resolve(meta.configDir, config.outDir);
    },
  },
);
~~~~

In single-file mode, Optique provides `meta.configPath` and `meta.configDir`
automatically, so the guard above only matters when metadata may be absent.


Config-only values
------------------

Sometimes a configuration value should *never* come from a CLI flag—it lives
entirely in the config file (or uses a default).  In that case, use
`fail<T>()` as the inner parser for `bindConfig()`.

`fail<T>()` always fails, so `bindConfig()` always falls back to the config
file or the supplied default.  Compare this with `constant(value)`, which
always succeeds and would prevent the config fallback from ever triggering.

~~~~ typescript twoslash
import { z } from "zod";
import { bindConfig, createConfigContext } from "@optique/config";
import { object } from "@optique/core/constructs";
import { fail, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { runAsync } from "@optique/run";

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
  // timeout only lives in the config file, not exposed as a CLI flag
  timeout: z.number().optional(),
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
  // No CLI flag — value comes only from config file or default
  timeout: bindConfig(fail<number>(), {
    context: configContext,
    key: "timeout",
    default: 30,
  }),
});

const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
});

console.log(`Timeout: ${result.timeout}s`);
~~~~

With a config file containing `"timeout": 60`, `result.timeout` will be `60`.
Without a config file (or if `timeout` is absent), it falls back to `30`.


Custom file formats
-------------------

By default, *@optique/config* parses JSON files.  You can provide a custom
file parser when creating the config context:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
});

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

// Pass fileParser to createConfigContext
const configContext = createConfigContext({
  schema: configSchema,
  fileParser: customParser,
});

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

const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
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
project), use the `load` callback in the runtime options:

~~~~ typescript twoslash
// @noErrors
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
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

      const customPath = resolve(parsed.config ?? "./.myapp.json");

      // Merge with priority: custom > project > user > system
      return {
        config: deepMerge(system, user, project, custom),
        meta: {
          configPath: customPath,
          configDir: dirname(customPath),
        },
      };
    },
  },
});
~~~~

This approach gives you full control over:

 -  File discovery and loading order
 -  Error handling policies (silent skip vs. hard error)
 -  Merging strategies (deep merge, shallow merge, array concatenation, etc.)
 -  File formats (JSON, TOML, YAML, etc.)

If no config data is available, return `undefined` or `null` directly
from `load()` (not wrapped in a `ConfigLoadResult`).  This signals
“no config found” and `bindConfig()` falls back to its defaults, just
like `getConfigPath` mode when the path is `undefined` or the file is
missing.

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
with other data sources.  When using `run()` or `runAsync()` with multiple
contexts, you can pass them all in the `contexts` array.  Earlier contexts
override later ones, enabling natural priority chains like CLI > environment
variables > config file > defaults:

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
import { runAsync } from "@optique/run";

// Combine config with other sources (e.g., environment variables)
const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,  // Typed from parser result!
  },
});
~~~~

The `getConfigPath` callback is fully typed based on the parser's result type,
providing type safety without manual type assertions.

You can also use `runWith()` from `@optique/core/facade` directly for
process-agnostic environments:

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

const result = await runWith(parser, "myapp", [configContext], {
  args: process.argv.slice(2),
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
});
~~~~


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
import { runAsync } from "@optique/run";

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
const result = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
  args: [],
});

console.log(result.host); // "localhost" (default)
~~~~

### Invalid config file

If the config file fails validation, an error is thrown:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
const configContext = createConfigContext({ schema: z.object({ host: z.string() }) });
const parser = object({
  config: option("--config", string()),
  host: bindConfig(option("--host", string()), { context: configContext, key: "host" }),
});
// ---cut-before---
import { runAsync } from "@optique/run";

try {
  const result = await runAsync(parser, {
    contexts: [configContext],
    contextOptions: {
      getConfigPath: (parsed) => "/path/to/invalid-config.json",
    },
    args: [],
  });
} catch (error) {
  console.error("Config validation failed:", error);
}
~~~~

### Fallback validation

Since Optique 1.0.0, fallback values produced by `bindConfig()` are
re-validated against the inner CLI parser's constraints (regex patterns,
numeric bounds, `choice()` values, etc.).  This applies to both values
loaded from the config file and to the configured `default`.

For example, the following parser rejects the default `80` because it
is below the inner CLI parser's `min: 1024` bound:

~~~~ typescript twoslash
import { z } from "zod";
import { option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
import { bindConfig, createConfigContext } from "@optique/config";

const configContext = createConfigContext({
  schema: z.object({ port: z.number().optional() }),
});
// ---cut-before---
bindConfig(option("--port", integer({ min: 1024 })), {
  context: configContext,
  key: "port",
  default: 80, // rejected at runtime: must be >= 1024
});
~~~~

Validation is forwarded through standard combinators (`optional()`,
`withDefault()`, `group()`, `command()`) and through wrapping
`bindEnv()` / `bindConfig()` layers, so a constraint defined on a deeply
nested primitive is still enforced against a fallback value.

`multiple()` attaches its own `validateValue`: it enforces the
configured `min` / `max` arity against the fallback array length and,
*if* the inner parser exposes a `validateValue` hook, walks each
element through it.  Arity enforcement is unconditional — it kicks in
even when the inner parser has no `validateValue` — and a non-array
fallback (for example a mis-typed default escaped through `as never`)
is rejected outright because `multiple()` can never produce a
non-array shape from CLI input.

`nonEmpty()` is a pure pass-through: it does not add an extra
non-empty check on the fallback path.  On the CLI path `nonEmpty()`
still enforces that at least one token was consumed, but on fallback
values `nonEmpty(multiple(...))` delegates entirely to the inner
`multiple()`'s arity rules.  If you need a “must have at least one
element” guarantee against fallback arrays, use
`multiple(..., { min: 1 })` directly.

`map()`, `derive()`, and `deriveFrom()` intentionally *strip* the
inner parser's `validateValue`: the mapping function is one-way, so
the mapped output type no longer corresponds to the inner parser's
constraints, and derived value parsers rebuild from *default*
dependency values rather than the live-resolved ones.  Wrapping an
inner parser in any of these suppresses revalidation of the wrapped
primitive's constraints — but outer combinators layered above
(notably `multiple()`) still enforce their own checks.


API reference
-------------

### `createConfigContext(options)`

Creates a configuration context.

Parameters
:    -  `options.schema`: Standard Schema validator for the config file
     -  `options.fileParser`: Optional custom parser for file contents
        (defaults to `JSON.parse`)

Returns
:   `ConfigContext<T, TConfigMeta>` implementing `SourceContext` interface

> [!IMPORTANT]
> If you call `configContext.getAnnotations()` manually, pass the returned
> object to low-level APIs such as `parse()`, `parseAsync()`,
> `parser.complete()`, `suggest()`, or `getDocPage()`. Calling
> `getAnnotations()` alone does not affect later parses.

### `bindConfig(parser, options)`

Binds a parser to configuration values with fallback priority.

Fallback values — values loaded from the config file and the configured
`default` — are re-validated against the inner CLI parser's constraints,
so constraints like `integer({ min })`, `string({ pattern })`, and
`choice([...])` cannot be bypassed through a config file or default.
See *Fallback validation* under “Error handling” for details.

Parameters
:    -  `parser`: The parser to bind

     -  `options.context`: Config context to use

     -  `options.key`: Property key or accessor function to extract value from
        config. Accessor functions receive two arguments:

         1)  `config`: validated config data
         2)  `meta`: config metadata if available
             (`ConfigMeta | undefined` by default)

     -  `options.default`: Optional default value

Returns
:   A new parser with config fallback behavior

### Runtime options

When using a config context with `run()`, `runAsync()`, or `runWith()`, the
following context-specific options are passed alongside the standard runner
options:

`getConfigPath`
:   Function to extract config file path from parsed result.  Optional when
    using the `load` callback.

`load`
:   Function that receives parsed result and returns
    `ConfigLoadResult<TConfigMeta>` (or Promise of it).  `meta` may be
    `undefined`.  Return `undefined` or `null` directly (not wrapped in
    a `ConfigLoadResult`) to signal that no config data is available.
    Use this for multi-file merging scenarios.  Optional when using
    `getConfigPath`.

At least one of `getConfigPath` or `load` must be provided.

Each `run()`, `runAsync()`, or `runWith()` call snapshots config annotations
per run, so reusing the same `ConfigContext` instance across independent or
concurrent runs is safe.

When calling `configContext.getAnnotations()` manually, remember that the
call only returns annotations.  It does not mutate global state or affect
later parses by itself.  To use those values with low-level APIs such as
`parse()` or `suggestSync()`, pass the returned annotations explicitly.

### `ConfigMeta`

Default config metadata shape:

 -  `configPath`: Absolute path to the config file
 -  `configDir`: Directory containing the config file


Limitations
-----------

 -  *File I/O is async* — config loading always returns a Promise due to
    file reading, so use `runAsync()` or `run()` (which returns a Promise
    when contexts are provided)
 -  *JSON only by default* — Other formats require the `fileParser` option
    on `createConfigContext()` or a custom `load` callback
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
import { object } from "@optique/core/constructs";
import { option, flag } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { runAsync } from "@optique/run";

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
const config = await runAsync(parser, {
  contexts: [configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
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
