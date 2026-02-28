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

const verbose = bindEnv(option("--verbose", bool()), {
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
with configuration contexts:

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
