@optique/standard-schema
========================

Standard Schema value parsers for Optique. This package lets you use any
[Standard Schema]-compatible validator as an *@optique/core* value parser.

[Standard Schema]: https://standardschema.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/standard-schema jsr:@optique/run jsr:@optique/core npm:@standard-schema/spec npm:arktype
npm  add     @optique/standard-schema     @optique/run     @optique/core     @standard-schema/spec arktype
pnpm add     @optique/standard-schema     @optique/run     @optique/core     @standard-schema/spec arktype
yarn add     @optique/standard-schema     @optique/run     @optique/core     @standard-schema/spec arktype
bun  add     @optique/standard-schema     @optique/run     @optique/core     @standard-schema/spec arktype
~~~~

Replace `arktype` with any Standard Schema-compatible library you want to use.


Quick example
-------------

The following example validates an email address with an ArkType schema through
the generic `standardSchema()` adapter.

~~~~ typescript
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { run } from "@optique/run";
import { standardSchema } from "@optique/standard-schema";
import { type } from "arktype";

const cli = run(
  object({
    email: option("--email",
      standardSchema(type("string.email"), {
        placeholder: "",
        metavar: "EMAIL",
      }),
    ),
  }),
);

console.log(`Welcome, ${cli.email}!`);
~~~~


Async schemas
-------------

Use `standardSchemaAsync()` when the validator may perform async work:

~~~~ typescript
import { option } from "@optique/core/primitives";
import { runAsync } from "@optique/run";
import { standardSchemaAsync } from "@optique/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";

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

const apiKey = option("--api-key",
  standardSchemaAsync(apiKeySchema, {
    placeholder: "",
    metavar: "API_KEY",
  }),
);

const key = await runAsync(apiKey);
~~~~

The synchronous `standardSchema()` helper rejects async validation results and
asks you to use `standardSchemaAsync()` instead.


Dedicated adapters
------------------

Standard Schema intentionally exposes validation results, not library-specific
metadata. This package therefore stays conservative: it does not infer choices,
completion suggestions, Boolean CLI literals, or specialized metavars from the
underlying schema.

Use *@optique/zod* or *@optique/valibot* when you want richer behavior for
those libraries. Use *@optique/standard-schema* when portability matters, or
when your schema library does not have a dedicated Optique adapter.
