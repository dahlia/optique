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
const email = zod(z.string().email(), { placeholder: "" });

// Port number with range validation
const port = zod(z.coerce.number().int().min(1024).max(65535), { placeholder: 1024 });

// Enum choices
const logLevel = zod(z.enum(["debug", "info", "warn", "error"]), { placeholder: "debug" });
~~~~

> [!IMPORTANT]
> The options object is required. In particular, `placeholder` must be a valid
> stand-in value of the schema's output type. Optique uses it during deferred
> prompt resolution, so it does not need to be meaningful user data, but it
> must be safe for downstream transforms.


String coercion
---------------

CLI arguments are always strings, so use `z.coerce` for non-string types:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { z } from "zod";
// ---cut-before---
// ✅ Correct: Use z.coerce for numbers
const age = zod(z.coerce.number().int().min(0), { placeholder: 0 });

// ❌ Won't work: z.number() expects actual numbers, not strings
const num = zod(z.number(), { placeholder: 0 });  // [!code error]
~~~~

> [!NOTE]
> Both `z.boolean()` and `z.coerce.boolean()` are handled specially:
> instead of rejecting CLI strings or applying JavaScript truthiness
> semantics, Optique accepts CLI-friendly literals (`true`/`false`,
> `1`/`0`, `yes`/`no`, `on`/`off`, case-insensitive).


Transformations
---------------

Zod's transformation capabilities work seamlessly with Optique:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { z } from "zod";
// ---cut-before---
// Parse and transform to Date
const startDate = zod(z.string().transform((s) => new Date(s)), { placeholder: new Date(0) });

// Transform to uppercase
const name = zod(z.string().transform((s) => s.toUpperCase()), { placeholder: "" });
~~~~


Async schemas
-------------

*This API is available since Optique 1.1.0.*

Use `zodAsync()` when a schema depends on async refinements or transforms.  The
returned value parser is async, so run the containing parser with
`runAsync()` or `await run()`:

~~~~ typescript twoslash
async function isKnownApiKey(value: string): Promise<boolean> {
  return await Promise.resolve(value.startsWith("live_"));
}
// ---cut-before---
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { runAsync } from "@optique/run";
import { zodAsync } from "@optique/zod";
import { z } from "zod";

const parser = object({
  apiKey: option(
    "--api-key",
    zodAsync(
      z.string().refine(isKnownApiKey, "Unknown API key."),
      { placeholder: "" },
    ),
  ),
});

const config = await runAsync(parser, {
  args: ["--api-key", "live_secret"],
});
~~~~

The synchronous `zod()` helper remains synchronous and still rejects schemas
that require Zod's async parse path.  `zodAsync()` preserves the same metavar
inference, choices, suggestions, Boolean literal conversion, formatting, and
custom error handling as `zod()`.  Fallback values supplied through
`bindEnv()` or `bindConfig()` are validated by the same schema before they are
accepted.

Async validation may run during fallback resolution and other repeated parser
paths, including shell completion requests.  Keep remote checks bounded and
cached when possible, and prefer enum or literal schemas for completion choices
so suggestions stay metadata-driven.


Custom error messages
---------------------

Customize error messages for better user experience:

~~~~ typescript twoslash
import { zod } from "@optique/zod";
import { message } from "@optique/core/message";
import { z } from "zod";
// ---cut-before---
const email = zod(z.string().email(), {
  placeholder: "",
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
  email: option("--email", zod(z.string().email(), { placeholder: "" })),
  port: option("-p", "--port", zod(z.coerce.number().int().min(1024).max(65535), { placeholder: 1024 })),
  logLevel: option("--log-level", zod(z.enum(["debug", "info", "warn", "error"]), { placeholder: "debug" })),
  startDate: argument(zod(z.string().transform((s) => new Date(s)), { placeholder: new Date(0) })),
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

 -  *`zod()` remains synchronous*: Async Zod features like
    `refine(async ...)` and async transforms require `zodAsync()`.  The sync
    helper detects schemas that need async parsing when possible and throws a
    `TypeError` instead of silently skipping validation.

 -  *Boolean parsing in unions*: The CLI-friendly boolean parsing (accepting
    `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`) applies only when the
    entire schema is recognized as a boolean type.  For unions that are not
    recognized as wholly boolean, arm precedence is preserved and parsing
    follows Zod's native union/coercion behavior.

The Zod integration provides a powerful way to reuse validation logic across
your entire application while maintaining full type safety and excellent error
messages.

<!-- cSpell: ignore coerce -->
