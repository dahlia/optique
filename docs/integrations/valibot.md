---
description: >-
  Use Valibot schemas for validating command-line arguments with a lightweight,
  modular validation library offering minimal bundle size.
---

Valibot integration
===================

*This API is available since Optique 0.7.0.*

The *@optique/valibot* package provides seamless integration with [Valibot],
enabling you to use Valibot schemas for validating command-line arguments.
Valibot is a modular validation library with a significantly smaller bundle size
(~10KB) compared to Zod (~52KB), making it ideal for CLI applications where
bundle size matters.

::: code-group

~~~~ bash [Deno]
deno add --jsr @optique/valibot @valibot/valibot
~~~~

~~~~ bash [npm]
npm add @optique/valibot valibot
~~~~

~~~~ bash [pnpm]
pnpm add @optique/valibot valibot
~~~~

~~~~ bash [Yarn]
yarn add @optique/valibot valibot
~~~~

~~~~ bash [Bun]
bun add @optique/valibot valibot
~~~~

:::

> [!NOTE]
> When using Deno, import Valibot from `@valibot/valibot` instead of `valibot`:
>
> ::: code-group
>
> ~~~~ typescript [Deno]
> import * as v from "@valibot/valibot";
> ~~~~
>
> ~~~~ typescript [Node.js]
> import * as v from "valibot";
> ~~~~
>
> ~~~~ typescript [Bun]
> import * as v from "valibot";
> ~~~~
>
> :::

[Valibot]: https://valibot.dev/


Basic usage
-----------

The `valibot()` function creates a value parser from any Valibot schema:

~~~~ typescript twoslash
import { valibot } from "@optique/valibot";
import * as v from "valibot";

// Email validation
const email = valibot(v.pipe(v.string(), v.email()));

// Port number with range validation
const port = valibot(
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(1024),
    v.maxValue(65535)
  )
);

// Picklist choices
const logLevel = valibot(v.picklist(["debug", "info", "warn", "error"]));
~~~~


Explicit transformations
------------------------

CLI arguments are always strings, so use explicit `v.transform()` for non-string
types:

~~~~ typescript twoslash
import { valibot } from "@optique/valibot";
import * as v from "valibot";
// ---cut-before---
// ✅ Correct: Use v.pipe with v.transform for numbers
const age = valibot(
  v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(0))
);

// ❌ Won't work: v.number() expects actual numbers, not strings
const num = valibot(v.number());  // [!code error]
~~~~


Transformations
---------------

Valibot's transformation capabilities work seamlessly with Optique:

~~~~ typescript twoslash
import { valibot } from "@optique/valibot";
import * as v from "valibot";
// ---cut-before---
// Parse and transform to Date
const startDate = valibot(
  v.pipe(v.string(), v.transform((s) => new Date(s)))
);

// Transform to uppercase
const name = valibot(
  v.pipe(v.string(), v.transform((s) => s.toUpperCase()))
);
~~~~


Custom error messages
---------------------

Customize error messages for better user experience:

~~~~ typescript twoslash
import { valibot } from "@optique/valibot";
import { message } from "@optique/core/message";
import * as v from "valibot";
// ---cut-before---
const email = valibot(v.pipe(v.string(), v.email()), {
  metavar: "EMAIL",
  errors: {
    valibotError: (issues, input) =>
      message`Please provide a valid email address, got ${input}.`
  }
});
~~~~


Integration with Optique
------------------------

Valibot parsers work seamlessly with all Optique features:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { valibot } from "@optique/valibot";
import * as v from "valibot";

const config = object({
  email: option("--email", valibot(v.pipe(v.string(), v.email()))),
  port: option(
    "-p",
    "--port",
    valibot(
      v.pipe(
        v.string(),
        v.transform(Number),
        v.number(),
        v.integer(),
        v.minValue(1024),
        v.maxValue(65535)
      )
    )
  ),
  logLevel: option(
    "--log-level",
    valibot(v.picklist(["debug", "info", "warn", "error"]))
  ),
  startDate: argument(
    valibot(v.pipe(v.string(), v.transform((s) => new Date(s))))
  )
});
~~~~


Version compatibility
---------------------

The `@optique/valibot` package supports Valibot version 0.42.0 and above.


Limitations
-----------

 -  *Async validations not supported*: Since Optique's parsing is synchronous,
    async Valibot features like `pipeAsync()` cannot be used. Perform async
    validation after parsing if needed.

The Valibot integration provides a lightweight yet powerful way to reuse
validation logic across your entire application while maintaining full type
safety, excellent error messages, and minimal bundle size.

<!-- cSpell: ignore valibot picklist -->
