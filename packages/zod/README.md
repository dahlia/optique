@optique/zod
============

Zod value parsers for Optique. This package provides seamless integration
between [Zod] schemas and *@optique/core*, enabling powerful validation and
type-safe parsing of command-line arguments.

[Zod]: https://zod.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/zod jsr:@optique/run jsr:@optique/core zod
npm  add     @optique/zod     @optique/run     @optique/core zod
pnpm add     @optique/zod     @optique/run     @optique/core zod
yarn add     @optique/zod     @optique/run     @optique/core zod
bun  add     @optique/zod     @optique/run     @optique/core zod
~~~~

This package supports Zod versions 3.25.0 and above, including Zod v4.


Quick example
-------------

The following example uses the `zod()` value parser to validate an email
address.

~~~~ typescript
import { run } from "@optique/run";
import { option } from "@optique/core/parser";
import { zod } from "@optique/zod";
import { z } from "zod";

const cli = run({
  email: option("--email", zod(z.string().email())),
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
import { zod } from "@optique/zod";
import { z } from "zod";

const email = option("--email", zod(z.string().email()));
~~~~

### URL validation

~~~~ typescript
import { zod } from "@optique/zod";
import { z } from "zod";

const url = option("--url", zod(z.string().url()));
~~~~

### Port numbers with range validation

> [!IMPORTANT]
> Always use `z.coerce` for non-string types, since CLI arguments are
> always strings.

~~~~ typescript
import { zod } from "@optique/zod";
import { z } from "zod";

const port = option("-p", "--port",
  zod(z.coerce.number().int().min(1024).max(65535))
);
~~~~

### Enum choices

~~~~ typescript
import { zod } from "@optique/zod";
import { z } from "zod";

const logLevel = option("--log-level",
  zod(z.enum(["debug", "info", "warn", "error"]))
);
~~~~

### Date transformations

~~~~ typescript
import { zod } from "@optique/zod";
import { z } from "zod";

const startDate = argument(
  zod(z.string().transform((s) => new Date(s)))
);
~~~~


Custom error messages
---------------------

You can customize error messages using the `errors` option:

~~~~ typescript
import { zod } from "@optique/zod";
import { message } from "@optique/core/message";
import { z } from "zod";

const email = option("--email", zod(z.string().email(), {
  metavar: "EMAIL",
  errors: {
    zodError: (error, input) =>
      message`Please provide a valid email address, got ${input}.`
  }
}));
~~~~


Important notes
---------------

### Always use `z.coerce` for non-string types

CLI arguments are always strings. If you want to parse numbers, booleans,
or other types, you must use `z.coerce`:

~~~~ typescript
// ✅ Correct
const port = option("-p", zod(z.coerce.number()));

// ❌ Won't work (CLI arguments are always strings)
const port = option("-p", zod(z.number()));
~~~~

### Async refinements are not supported

Optique's `ValueParser.parse()` is synchronous, so async Zod features like
async refinements cannot be supported:

~~~~ typescript
// ❌ Not supported
const email = option("--email",
  zod(z.string().refine(async (val) => await checkDB(val)))
);
~~~~

If you need async validation, perform it after parsing the CLI arguments.


Zod version compatibility
-------------------------

This package supports both Zod v3 (3.25.0+) and Zod v4 (4.0.0+). The basic
functionality works identically in both versions.

 -  **Zod v3**: Uses standard error messages from `error.issues[0].message`
 -  **Zod v4**: Automatically uses `prettifyError()` when available for better
    error formatting

### Testing with different Zod versions

For contributors and users who want to test compatibility:

~~~~ bash
# Test with Zod v3
pnpm run test:zod3

# Test with Zod v4
pnpm run test:zod4

# Test with both versions sequentially
pnpm run test:all-versions
~~~~


For more resources
------------------

 -  [Optique documentation]
 -  [Zod documentation]
 -  [Examples directory](/examples/)

[Optique documentation]: https://optique.dev/
[Zod documentation]: https://zod.dev/
