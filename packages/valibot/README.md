@optique/valibot
================

Valibot value parsers for Optique. This package provides seamless integration
between [Valibot] schemas and *@optique/core*, enabling powerful validation and
type-safe parsing of command-line arguments with minimal bundle size.

[Valibot]: https://valibot.dev/


Installation
------------

~~~~ bash
deno add --jsr @optique/valibot @optique/run @optique/core @valibot/valibot
npm  add       @optique/valibot @optique/run @optique/core valibot
pnpm add       @optique/valibot @optique/run @optique/core valibot
yarn add       @optique/valibot @optique/run @optique/core valibot
bun  add       @optique/valibot @optique/run @optique/core valibot
~~~~

> [!NOTE]
> When using Deno, import Valibot from `@valibot/valibot` instead of `valibot`:
>
> ~~~~ typescript
> import * as v from "@valibot/valibot";  // Deno
> import * as v from "valibot";            // Node.js, Bun
> ~~~~

This package supports Valibot versions 0.42.0 and above.


Quick example
-------------

The following example uses the `valibot()` value parser to validate an email
address.

~~~~ typescript
import { run } from "@optique/run";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const cli = run(
  object({
    email: option("--email",
      valibot(v.pipe(v.string(), v.email()), { placeholder: "" }),
    ),
  }),
);

console.log(`Welcome, ${cli.email}!`);
~~~~

Run it:

~~~~ bash
$ node cli.js --email user@example.com
Welcome, user@example.com!

$ node cli.js --email invalid-email
Error: Invalid email
~~~~


Common use cases
----------------

### Email validation

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const email = option("--email",
  valibot(v.pipe(v.string(), v.email()), { placeholder: "" }),
);
~~~~

### URL validation

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const url = option("--url",
  valibot(v.pipe(v.string(), v.url()), { placeholder: "" }),
);
~~~~

### Port numbers with range validation

> [!IMPORTANT]
> Always use explicit transformations with `v.pipe()` and `v.transform()` for
> non-string types, since CLI arguments are always strings.

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const port = option("-p", "--port",
  valibot(v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(1024),
    v.maxValue(65535)
  ), { placeholder: 0 }),
);
~~~~

### Enum choices

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const logLevel = option("--log-level",
  valibot(v.picklist(["debug", "info", "warn", "error"]),
    { placeholder: "debug" }),
);
~~~~

### Date transformations

~~~~ typescript
import { argument } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const startDate = argument(
  valibot(v.pipe(v.string(), v.transform((s: string) => new Date(s))),
    { placeholder: new Date(0) }),
);
~~~~


Async schemas
-------------

Use `valibotAsync()` when a schema depends on async validations, and run the
containing parser with `runAsync()` or `await run()`:

~~~~ typescript
import { runAsync } from "@optique/run";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { valibotAsync } from "@optique/valibot";
import * as v from "valibot";

async function checkProject(value: string): Promise<boolean> {
  return await Promise.resolve(value.startsWith("project-"));
}

const parser = object({
  project: option("--project",
    valibotAsync(
      v.pipeAsync(v.string(), v.checkAsync(checkProject, "Unknown project.")),
      { placeholder: "" },
    ),
  ),
});

const cli = await runAsync(parser);
~~~~

The `valibot()` helper remains synchronous and rejects schemas that require
Valibot's async parse path.  `valibotAsync()` preserves metavar inference,
choices, suggestions, formatting, and custom errors.  Fallback values from
`bindEnv()` or `bindConfig()` are validated by the same schema before they are
accepted.

Async validation can run during fallback resolution and other repeated parser
paths, including shell completion requests.  Keep remote checks bounded and
cached when possible.


Custom error messages
---------------------

You can customize error messages using the `errors` option:

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import { message } from "@optique/core/message";
import * as v from "valibot";

const email = option("--email", valibot(v.pipe(v.string(), v.email()), {
  placeholder: "",
  metavar: "EMAIL",
  errors: {
    valibotError: (issues, input) =>
      message`Please provide a valid email address, got ${input}.`
  }
}));
~~~~


Important notes
---------------

### Always use explicit transformations for non-string types

CLI arguments are always strings. If you want to parse numbers, booleans,
or other types, you must use explicit `v.transform()`:

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

// ✅ Correct
const port = option("-p",
  valibot(v.pipe(v.string(), v.transform(Number)), { placeholder: 0 }),
);

// ❌ Won't work (CLI arguments are always strings)
// const port = option("-p", valibot(v.number()));
~~~~

### `valibot()` is synchronous

The `valibot()` helper returns a sync value parser, so async Valibot features
like `pipeAsync()` require `valibotAsync()`:

~~~~ typescript
import { option } from "@optique/core/primitives";
import { valibot, valibotAsync } from "@optique/valibot";
import * as v from "valibot";

// ❌ Not supported by valibot()
const syncEmail = option("--email",
  valibot(v.pipeAsync(v.string(),
    v.checkAsync(async (val) => await checkDB(val))),
    { placeholder: "" }),
);

// ✅ Use valibotAsync() and runAsync()
const asyncEmail = option("--email",
  valibotAsync(v.pipeAsync(v.string(),
    v.checkAsync(async (val) => await checkDB(val))),
    { placeholder: "" }),
);
~~~~


For more resources
------------------

 -  [Optique documentation]
 -  [Valibot documentation]
 -  [Examples directory](/examples/)

[Optique documentation]: https://optique.dev/
[Valibot documentation]: https://valibot.dev/
