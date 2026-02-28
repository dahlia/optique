---
description: >-
  Bind parser fields to environment variables with type-safe parsing and
  fallback behavior.
---

Environment variable support
============================

*This API is available since Optique 1.0.0.*

The *@optique/env* package lets you bind parser values to environment
variables while preserving Optique's type safety and parser composition model.

The fallback priority is:

1.  *CLI argument*
2.  *Environment variable*
3.  *Default value*
4.  *Error*

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/env
~~~~

~~~~ bash [npm]
npm add @optique/env
~~~~

~~~~ bash [pnpm]
pnpm add @optique/env
~~~~

~~~~ bash [Yarn]
yarn add @optique/env
~~~~

~~~~ bash [Bun]
bun add @optique/env
~~~~

:::


Basic usage
-----------

### 1. Create an environment context

~~~~ typescript twoslash
import { createEnvContext } from "@optique/env";

const envContext = createEnvContext({
  prefix: "MYAPP_",
});
~~~~

You can also provide a custom source function for tests or custom runtimes:

~~~~ typescript twoslash
import { createEnvContext } from "@optique/env";

const mockEnv: Record<string, string> = {
  MYAPP_HOST: "test.example.com",
};

const envContext = createEnvContext({
  prefix: "MYAPP_",
  source: (key) => mockEnv[key],
});
~~~~

### 2. Bind parsers to environment keys

~~~~ typescript twoslash
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const host = bindEnv(option("--host", string()), {
  context: envContext,
  key: "HOST",
  parser: string(),
  default: "localhost",
});

const port = bindEnv(option("--port", integer()), {
  context: envContext,
  key: "PORT",
  parser: integer(),
  default: 3000,
});

const verbose = bindEnv(option("--verbose"), {
  context: envContext,
  key: "VERBOSE",
  parser: bool(),
  default: false,
});
~~~~

### 3. Run with contexts

Use `run()`, `runSync()`, or `runAsync()` from *@optique/run* with
`contexts: [envContext]`.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { runAsync } from "@optique/run";

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
  verbose: bindEnv(option("--verbose"), {
    context: envContext,
    key: "VERBOSE",
    parser: bool(),
    default: false,
  }),
});

const result = await runAsync(parser, {
  contexts: [envContext],
});
~~~~


Boolean values
--------------

`bool()` parses common environment Boolean literals (case-insensitive):

 -  true values: `"true"`, `"1"`, `"yes"`, `"on"`
 -  false values: `"false"`, `"0"`, `"no"`, `"off"`

~~~~ typescript twoslash
import { bool } from "@optique/env";

const parser = bool();
~~~~


Env-only values
---------------

If a value should come only from environment (or default), pair `bindEnv()`
with `fail<T>()`:

~~~~ typescript twoslash
import { bindEnv, createEnvContext } from "@optique/env";
import { fail } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const timeout = bindEnv(fail<number>(), {
  context: envContext,
  key: "TIMEOUT",
  parser: integer(),
  default: 30,
});
~~~~


Composing with other contexts
-----------------------------

Environment context is a regular `SourceContext`, so it composes naturally
with configuration contexts.  The *outermost* wrapper is checked first
during completion, so nesting order determines fallback priority.
Wrapping as `bindEnv(bindConfig(option(...)))` gives:

CLI argument > Environment variable > Config file > Default value

~~~~ typescript twoslash
import { z } from "zod";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createConfigContext, bindConfig } from "@optique/config";
import { bindEnv, createEnvContext } from "@optique/env";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({
  schema: z.object({ host: z.string() }),
});

const parser = object({
  config: option("--config", string()),
  host: bindEnv(
    bindConfig(option("--host", string()), {
      context: configContext,
      key: "host",
      default: "localhost",
    }),
    {
      context: envContext,
      key: "HOST",
      parser: string(),
    },
  ),
});

await runAsync(parser, {
  contexts: [envContext, configContext],
  getConfigPath: (parsed) => parsed.config,
});
~~~~


Prefix and key resolution
-------------------------

When `bindEnv()` looks up an environment variable, it concatenates the
context's `prefix` with the `key` you pass.  For example:

| `prefix`   | `key`      | Looked-up variable |
| ---------- | ---------- | ------------------ |
| `"MYAPP_"` | `"HOST"`   | `MYAPP_HOST`       |
| `"MYAPP_"` | `"PORT"`   | `MYAPP_PORT`       |
| `""`       | `"EDITOR"` | `EDITOR`           |

If you omit `prefix` (or pass `""`), the key is used as-is.  This is useful
when binding to well-known variables like `EDITOR` or `HOME` that have no
application-specific prefix:

~~~~ typescript twoslash
import { bindEnv, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const envContext = createEnvContext();  // no prefix

const editor = bindEnv(option("--editor", string()), {
  context: envContext,
  key: "EDITOR",
  parser: string(),
  default: "vi",
});
~~~~


Using other value parsers
-------------------------

The `parser` option in `bindEnv()` accepts any Optique `ValueParser`.
Because environment variables are always strings, the value parser converts
the raw string into the target type.  All built-in value parsers from
*@optique/core* work here:

~~~~ typescript twoslash
import { bindEnv, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { port, url, string } from "@optique/core/valueparser";

const envContext = createEnvContext({ prefix: "MYAPP_" });

// Parse as a URL
const apiUrl = bindEnv(option("--api-url", url()), {
  context: envContext,
  key: "API_URL",
  parser: url(),
});

// Parse as a port number (validated range 0–65535)
const listenPort = bindEnv(option("--port", port()), {
  context: envContext,
  key: "PORT",
  parser: port(),
  default: 8080,
});
~~~~

You can also use value parsers from integration packages such as
*@optique/zod* or *@optique/valibot* if you need richer validation:

~~~~ typescript twoslash
import { z } from "zod";
import { bindEnv, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { zod } from "@optique/zod";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const logLevel = bindEnv(
  option("--log-level", zod(z.enum(["debug", "info", "warn", "error"]))),
  {
    context: envContext,
    key: "LOG_LEVEL",
    parser: zod(z.enum(["debug", "info", "warn", "error"])),
    default: "info" as const,
  },
);
~~~~


Error handling
--------------

### Missing environment variable

When the environment variable is not set and no `default` is provided,
`bindEnv()` produces an error message that includes the full variable name
(prefix + key):

~~~~ text
Missing required environment variable: MYAPP_API_KEY.
~~~~

If a `default` is provided, the default is used silently.

### Invalid value

When the environment variable is set but the value parser rejects it,
the error from the value parser propagates directly.  For example, if
`MYAPP_PORT` is set to `"abc"` and the parser is `integer()`:

~~~~ text
Expected an integer, but received "abc".
~~~~

Similarly, `bool()` rejects unrecognized literals:

~~~~ text
Invalid Boolean value: "maybe". Expected one of "true", "1", "yes", "on",
"false", "0", "no", or "off"
~~~~

### Help, version, and completion

Like config contexts, environment contexts work seamlessly with help,
version, and completion features.  These are handled before environment
variable lookup, so `--help` always works even when required environment
variables are missing:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const parser = object({
  apiKey: bindEnv(option("--api-key", string()), {
    context: envContext,
    key: "API_KEY",
    parser: string(),
    // No default — required from CLI or env
  }),
});

await runAsync(parser, {
  contexts: [envContext],
  help: "option",
  version: "1.0.0",
});
~~~~


API reference
-------------

### `createEnvContext(options?)`

Creates an environment context for use with Optique runners.

Parameters
:    -  `options.prefix`: String prefix prepended to all keys when looking
        up environment variables.  Defaults to `""`.
     -  `options.source`: Custom function `(key: string) => string | undefined`
        for reading environment values.  Defaults to `Deno.env.get` on Deno
        and `process.env` on Node.js/Bun.

Returns
:   `EnvContext` implementing `SourceContext` and `Disposable`.

### `bindEnv(parser, options)`

Binds a parser to environment variables with fallback priority
(CLI > environment > default > error).

Parameters
:    -  `parser`: The inner parser to wrap.

     -  `options.context`: `EnvContext` to read from.

     -  `options.key`: Environment variable key *without* the prefix.
        The actual variable looked up is `prefix + key`.

     -  `options.parser`: A `ValueParser` used to parse the raw string value
        from the environment.

     -  `options.default`: Optional default value used when neither CLI
        nor environment provides a value.

Returns
:   A new parser with environment fallback behavior.

### `bool(options?)`

Creates a synchronous `ValueParser<"sync", boolean>` that accepts common
Boolean literals (case-insensitive).

Parameters
:    -  `options.metavar`: Metavariable name shown in help text.
        Defaults to `"BOOLEAN"`.
     -  `options.errors.invalidFormat`: Custom error message or function
        for unrecognized input.

Returns
:   `ValueParser<"sync", boolean>`

### `envKey`

Symbol key (`Symbol.for("@optique/env")`) used to store environment source
data in annotations.

### `EnvContext`

Interface extending `SourceContext` with two additional properties:

 -  `prefix`: The prefix string passed to `createEnvContext()`
 -  `source`: The `EnvSource` function used to read variables


Limitations
-----------

 -  *String-only input* — Environment variables are always strings, so a
    `parser` is required in every `bindEnv()` call to convert the raw string
    into the target type.  Unlike `bindConfig()`, there is no way to skip
    the parser.
 -  *Flat keys only* — Environment variables have no native nesting structure.
    Unlike config files, you cannot use accessor functions to navigate nested
    objects.  Use naming conventions (e.g., `DB_HOST`, `DB_PORT`) to
    represent structure.
 -  *No schema validation* — Unlike *@optique/config*, there is no schema that
    validates the set of environment variables as a whole.  Each binding is
    validated independently.
 -  *Synchronous reads* — `createEnvContext()` reads environment variables
    synchronously via `Deno.env.get` or `process.env`.  The context itself
    does not add async overhead, but if the `parser` used in `bindEnv()` is
    async, the overall parsing becomes async.
