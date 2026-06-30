---
description: >-
  Use any Standard Schema-compatible validator as an Optique value parser.
---

Standard Schema integration
===========================

*This API is available since Optique 1.2.0.*

The *@optique/standard-schema* package turns any [Standard Schema]-compatible
validator into an Optique value parser. Use it when you want to reuse schemas
from libraries such as Zod, Valibot, ArkType, Yup, or Joi without adding a
library-specific Optique adapter.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/standard-schema npm:@standard-schema/spec npm:arktype
~~~~

~~~~ bash [npm]
npm add @optique/standard-schema @standard-schema/spec arktype
~~~~

~~~~ bash [pnpm]
pnpm add @optique/standard-schema @standard-schema/spec arktype
~~~~

~~~~ bash [Yarn]
yarn add @optique/standard-schema @standard-schema/spec arktype
~~~~

~~~~ bash [Bun]
bun add @optique/standard-schema @standard-schema/spec arktype
~~~~

:::

Replace `arktype` with any Standard Schema-compatible library you want to use.

[Standard Schema]: https://standardschema.dev/


Basic usage
-----------

The `standardSchema()` function creates a value parser from a Standard
Schema-compatible validator:

~~~~ typescript twoslash
import { standardSchema } from "@optique/standard-schema";
import { type } from "arktype";

const email = standardSchema(type("string.email"), {
  placeholder: "",
  metavar: "EMAIL",
});

const semver = standardSchema(type("/^(\\d+)\\.(\\d+)\\.(\\d+)$/"), {
  placeholder: "0.0.0",
  metavar: "VERSION",
});
~~~~

> [!IMPORTANT]
> The options object is required. In particular, `placeholder` must be a valid
> stand-in value of the schema's output type. Optique uses it during deferred
> prompt resolution, so it does not need to be meaningful user data, but it
> must be safe for downstream transforms.


Integration with Optique
------------------------

Standard Schema parsers work like other value parsers:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { run } from "@optique/run";
import { standardSchema } from "@optique/standard-schema";
import { type } from "arktype";

const parser = object({
  email: option(
    "--email",
    standardSchema(type("string.email"), {
      placeholder: "",
      metavar: "EMAIL",
    }),
  ),
  version: option(
    "--version",
    standardSchema(type("/^(\\d+)\\.(\\d+)\\.(\\d+)$/"), {
      placeholder: "0.0.0",
      metavar: "VERSION",
    }),
  ),
});

const config = run(parser, {
  args: ["--email", "user@example.com", "--version", "1.2.3"],
});
~~~~


Async schemas
-------------

Use `standardSchemaAsync()` when the validator may return a promise:

~~~~ typescript twoslash
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { runAsync } from "@optique/run";
import { standardSchemaAsync } from "@optique/standard-schema";

const apiKeySchema: StandardSchemaV1<unknown, string> = {
  "~standard": {
    version: 1,
    vendor: "example",
    async validate(value) {
      if (typeof value === "string" && value.startsWith("live_")) {
        return { value };
      }
      return { issues: [{ message: "Unknown API key." }] };
    },
  },
};

const parser = object({
  apiKey: option(
    "--api-key",
    standardSchemaAsync(apiKeySchema, {
      placeholder: "",
      metavar: "API_KEY",
    }),
  ),
});

const config = await runAsync(parser, {
  args: ["--api-key", "live_secret"],
});
~~~~

The synchronous `standardSchema()` helper remains synchronous and rejects async
validation results with a `TypeError`. Use `standardSchemaAsync()` and
`runAsync()` or `await run()` when validation may be async.


Custom error messages
---------------------

Customize Standard Schema validation errors with the `errors.schemaError`
option:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { standardSchema } from "@optique/standard-schema";
import { type } from "arktype";

const email = standardSchema(type("string.email"), {
  placeholder: "",
  metavar: "EMAIL",
  errors: {
    schemaError: (issues, input) =>
      message`Please provide a valid email address, got ${input}: ${issues[0]?.message ?? "Validation failed"}.`,
  },
});
~~~~


When to use dedicated adapters
------------------------------

Standard Schema exposes validation and typed output. It does not expose
library-specific metadata such as enum choices, parser shape, Boolean
semantics, or preferred metavars. Because of that, *@optique/standard-schema*
uses `"VALUE"` as the default metavar and does not provide choices or shell
completion suggestions.

Use *[@optique/zod](./zod.md)* or *[@optique/valibot](./valibot.md)* when you
want their richer CLI behavior, including inferred metavars, choices,
suggestions, and library-specific error callbacks. Use
*@optique/standard-schema* when portability matters, or when the schema library
does not have a dedicated Optique adapter.
