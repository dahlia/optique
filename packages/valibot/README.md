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
import { option } from "@optique/core/parser";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const cli = run({
  email: option("--email", valibot(v.pipe(v.string(), v.email()))),
});

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
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const email = option("--email", valibot(v.pipe(v.string(), v.email())));
~~~~

### URL validation

~~~~ typescript
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const url = option("--url", valibot(v.pipe(v.string(), v.url())));
~~~~

### Port numbers with range validation

> [!IMPORTANT]
> Always use explicit transformations with `v.pipe()` and `v.transform()` for
> non-string types, since CLI arguments are always strings.

~~~~ typescript
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
  ))
);
~~~~

### Enum choices

~~~~ typescript
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const logLevel = option("--log-level",
  valibot(v.picklist(["debug", "info", "warn", "error"]))
);
~~~~

### Date transformations

~~~~ typescript
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const startDate = argument(
  valibot(v.pipe(v.string(), v.transform((s) => new Date(s))))
);
~~~~


Custom error messages
---------------------

You can customize error messages using the `errors` option:

~~~~ typescript
import { valibot } from "@optique/valibot";
import { message } from "@optique/core/message";
import * as v from "valibot";

const email = option("--email", valibot(v.pipe(v.string(), v.email()), {
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
// ✅ Correct
const port = option("-p", valibot(v.pipe(v.string(), v.transform(Number))));

// ❌ Won't work (CLI arguments are always strings)
const port = option("-p", valibot(v.number()));
~~~~

### Async validations are not supported

Optique's `ValueParser.parse()` is synchronous, so async Valibot features like
async validations cannot be supported:

~~~~ typescript
// ❌ Not supported
const email = option("--email",
  valibot(v.pipeAsync(v.string(), v.checkAsync(async (val) => await checkDB(val))))
);
~~~~

If you need async validation, perform it after parsing the CLI arguments.


For more resources
------------------

 -  [Optique documentation]
 -  [Valibot documentation]
 -  [Examples directory](/examples/)

[Optique documentation]: https://optique.dev/
[Valibot documentation]: https://valibot.dev/
