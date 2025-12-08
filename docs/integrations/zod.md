---
description: >-
  Use Zod schemas for validating command-line arguments with seamless
  integration, type inference, and transformation support.
---

Zod integration
===============

*This API is available since Optique 0.7.0.*

The *@optique/zod* package provides seamless integration with [Zod], enabling
you to use Zod schemas for validating command-line arguments. This allows you
to leverage Zod's powerful validation capabilities and reuse existing schemas
across your CLI and application code.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/zod zod
~~~~

~~~~ bash [npm]
npm add @optique/zod zod
~~~~

~~~~ bash [pnpm]
pnpm add @optique/zod zod
~~~~

~~~~ bash [Yarn]
yarn add @optique/zod zod
~~~~

~~~~ bash [Bun]
bun add @optique/zod zod
~~~~

:::

[Zod]: https://zod.dev/


Basic usage
-----------

The `zod()` function creates a value parser from any Zod schema:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { z } from "zod";

// Email validation
const email = zod(z.string().email());

// Port number with range validation
const port = zod(z.coerce.number().int().min(1024).max(65535));

// Enum choices
const logLevel = zod(z.enum(["debug", "info", "warn", "error"]));
~~~~


String coercion
---------------

CLI arguments are always strings, so use `z.coerce` for non-string types:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { z } from "zod";
// ---cut-before---
// ✅ Correct: Use z.coerce for numbers
const age = zod(z.coerce.number().int().min(0));

// ❌ Won't work: z.number() expects actual numbers, not strings
const num = zod(z.number());  // [!code error]
~~~~


Transformations
---------------

Zod's transformation capabilities work seamlessly with Optique:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { z } from "zod";
// ---cut-before---
// Parse and transform to Date
const startDate = zod(z.string().transform((s) => new Date(s)));

// Transform to uppercase
const name = zod(z.string().transform((s) => s.toUpperCase()));
~~~~


Custom error messages
---------------------

Customize error messages for better user experience:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { message } from "@optique/core/message";
import { z } from "zod";
// ---cut-before---
const email = zod(z.string().email(), {
  metavar: "EMAIL",
  errors: {
    zodError: (error, input) =>
      message`Please provide a valid email address, got ${input}.`
  }
});
~~~~


Integration with Optique
------------------------

Zod parsers work seamlessly with all Optique features:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { zod } from "@optique/zod";
import { z } from "zod";

const config = object({
  email: option("--email", zod(z.string().email())),
  port: option("-p", "--port", zod(z.coerce.number().int().min(1024).max(65535))),
  logLevel: option("--log-level", zod(z.enum(["debug", "info", "warn", "error"]))),
  startDate: argument(zod(z.string().transform((s) => new Date(s))))
});
~~~~


Version compatibility
---------------------

The `@optique/zod` package supports both Zod v3 (3.25.0+) and Zod v4 (4.0.0+):

 -  **Zod v3**: Uses standard error messages from `error.issues[0].message`
 -  **Zod v4**: Automatically uses `prettifyError()` when available for better
    error formatting


Limitations
-----------

 -  *Async refinements not supported*: Since Optique's parsing is synchronous,
    async Zod features like `refine(async ...)` cannot be used. Perform async
    validation after parsing if needed.

The Zod integration provides a powerful way to reuse validation logic across
your entire application while maintaining full type safety and excellent error
messages.

<!-- cSpell: ignore coerce -->
