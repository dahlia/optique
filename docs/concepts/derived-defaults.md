---
description: >-
  Compute default values from the first-pass parse result while keeping CLI
  arguments as the highest-priority source.
---

Derived defaults
================

*This API is available since Optique 1.2.0.*

The *@optique/derived-defaults* package lets you compute fallback values from
values that Optique has already parsed.  This is useful when one option has a
natural default that depends on another option, but the user should still be
able to override it explicitly.

The fallback priority is:

1.  CLI argument
2.  Derived default
3.  Static default
4.  Error

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/derived-defaults
~~~~

~~~~ bash [npm]
npm add @optique/derived-defaults
~~~~

~~~~ bash [pnpm]
pnpm add @optique/derived-defaults
~~~~

~~~~ bash [Yarn]
yarn add @optique/derived-defaults
~~~~

~~~~ bash [Bun]
bun add @optique/derived-defaults
~~~~

:::


Basic usage
-----------

### 1. Create a derived-default context

Call `createDerivedDefaults()` with resolver functions.  Each resolver receives
the first-pass parse result and returns either a fallback value or `undefined`
when it has no value to provide.

~~~~ typescript twoslash
import { createDerivedDefaults } from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  workspaceRoot: (parsed: { readonly serviceRoot: string }) =>
    `${parsed.serviceRoot}/workspace`,
});
~~~~

### 2. Bind parsers to derived values

Use `bindDerivedDefault()` around the parser that should receive the derived
fallback:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  workspaceRoot: (parsed: { readonly serviceRoot: string }) =>
    `${parsed.serviceRoot}/workspace`,
});

const parser = object({
  serviceRoot: option("--service-root", string()),
  workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
    context: derived.context,
    key: "workspaceRoot",
  }),
});
~~~~

### 3. Run with contexts

Pass the derived-default context through `contexts`.  Optique first parses the
CLI input, then calls your resolvers with that parsed value and completes the
bound parsers from the resulting annotations.

> [!WARNING]
> `bindDerivedDefault()` only reads derived values when its context is
> registered with the runner.  Omitting `contexts: [derived.context]` from the
> `run()` call causes the parser to fall back to a static default if one exists
> or fail as a missing value.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  workspaceRoot: (parsed: { readonly serviceRoot: string }) =>
    `${parsed.serviceRoot}/workspace`,
});

const parser = object({
  serviceRoot: option("--service-root", string()),
  workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
    context: derived.context,
    key: "workspaceRoot",
  }),
});

const result = await runAsync(parser, {
  args: ["--service-root", "/srv/api"],
  contexts: [derived.context],
});

console.log(result.workspaceRoot); // "/srv/api/workspace"
~~~~


Priority order
--------------

CLI arguments always win over derived values.  If the resolver returns
`undefined`, `bindDerivedDefault()` falls through to the static `default` value
when one is provided:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  token: (parsed: { readonly service?: string }) =>
    parsed.service == null ? undefined : `${parsed.service}-token`,
});

const parser = object({
  service: option("--service", string()),
  token: bindDerivedDefault(option("--token", string()), {
    context: derived.context,
    key: "token",
    default: "local-token",
  }),
});

const cliValue = await runAsync(parser, {
  args: ["--service", "api", "--token", "manual"],
  contexts: [derived.context],
});

const derivedValue = await runAsync(parser, {
  args: ["--service", "api"],
  contexts: [derived.context],
});

console.log(cliValue.token); // "manual"
console.log(derivedValue.token); // "api-token"
~~~~


Validation
----------

Derived and static fallback values are validated through the wrapped parser.
For example, a derived port number must still satisfy the `integer()` parser's
range constraints:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  port: (parsed: { readonly profile: string }) =>
    parsed.profile === "public" ? 443 : 8080,
});

const parser = object({
  profile: option("--profile", string()),
  port: bindDerivedDefault(option("--port", integer({ min: 1, max: 65535 })), {
    context: derived.context,
    key: "port",
  }),
});
~~~~


Async resolvers
---------------

Resolvers may return promises.  Use `runAsync()` or another async runner when a
resolver is asynchronous:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

declare function loadToken(service: string): Promise<string>;

const derived = createDerivedDefaults({
  token: (parsed: { readonly service: string }) => loadToken(parsed.service),
});

const parser = object({
  service: option("--service", string()),
  token: bindDerivedDefault(option("--token", string()), {
    context: derived.context,
    key: "token",
  }),
});

const result = await runAsync(parser, {
  args: ["--service", "api"],
  contexts: [derived.context],
});
~~~~


Help defaults
-------------

Derived values are computed from runtime parse results, so help text cannot
show the exact default value without parsing first.  Use `defaultDescription`
to document how the value is derived.  It accepts any Optique `Message`, so you
can reference option names or use styled message fragments:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { message, optionName } from "@optique/core/message";
import { string } from "@optique/core/valueparser";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  workspaceRoot: (parsed: { readonly serviceRoot: string }) =>
    `${parsed.serviceRoot}/workspace`,
});

const parser = object({
  serviceRoot: option("--service-root", string()),
  workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
    context: derived.context,
    key: "workspaceRoot",
    defaultDescription: message`derived from ${
      optionName("--service-root")
    }`,
  }),
});
~~~~


Composing with other sources
----------------------------

`bindDerivedDefault()` composes with other source wrappers.  The outermost
wrapper decides the higher-priority source.  For example, this parser resolves
values in this order: CLI, then environment variable, then config file, then
derived default, then static default.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindConfig, createConfigContext } from "@optique/config";
import { bindEnv, createEnvContext } from "@optique/env";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const env = createEnvContext({ prefix: "APP_" });
const config = createConfigContext({
  schema: {
    "~standard": {
      version: 1,
      vendor: "example",
      validate: (input) => ({
        value: input as { readonly port?: number },
      }),
    },
  },
});
const derived = createDerivedDefaults({
  port: (parsed: { readonly profile: string }) =>
    parsed.profile === "public" ? 443 : 8080,
});

const parser = object({
  profile: option("--profile", string()),
  port: bindEnv(
    bindConfig(
      bindDerivedDefault(option("--port", integer()), {
        context: derived.context,
        key: "port",
        default: 3000,
      }),
      {
        context: config,
        key: "port",
      },
    ),
    {
      context: env,
      key: "PORT",
      parser: integer(),
    },
  ),
});
~~~~
