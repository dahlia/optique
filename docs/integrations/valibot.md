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
const email = valibot(v.pipe(v.string(), v.email()), { placeholder: "" });

// Port number with range validation
const port = valibot(
  v.pipe(
    v.string(),
    v.transform(Number),
    v.number(),
    v.integer(),
    v.minValue(1024),
    v.maxValue(65535)
  ),
  { placeholder: 0 },
);

// Picklist choices
const logLevel = valibot(v.picklist(["debug", "info", "warn", "error"]), { placeholder: "debug" });
~~~~

> [!IMPORTANT]
> The options object is required. In particular, `placeholder` must be a valid
> stand-in value of the schema's output type. Optique uses it during deferred
> prompt resolution, so it does not need to be meaningful user data, but it
> must be safe for downstream transforms.


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
  v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(0)),
  { placeholder: 0 },
);

// ❌ Won't work: v.number() expects actual numbers, not strings
const num = valibot(v.number(), { placeholder: 0 });  // [!code error]
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
  v.pipe(v.string(), v.transform((s) => new Date(s))),
  { placeholder: new Date(0) },
);

// Transform to uppercase
const name = valibot(
  v.pipe(v.string(), v.transform((s) => s.toUpperCase())),
  { placeholder: "" },
);
~~~~


Async schemas
-------------

*This API is available since Optique 1.1.0.*

Use `valibotAsync()` when a schema depends on async validations.  The returned
value parser is async, so run the containing parser with `runAsync()` or
`await run()`:

~~~~ typescript twoslash
async function isKnownProject(value: string): Promise<boolean> {
  return await Promise.resolve(value.startsWith("project-"));
}
// ---cut-before---
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { runAsync } from "@optique/run";
import { valibotAsync } from "@optique/valibot";
import * as v from "valibot";

const parser = object({
  project: option(
    "--project",
    valibotAsync(
      v.pipeAsync(
        v.string(),
        v.checkAsync(isKnownProject, "Unknown project."),
      ),
      { placeholder: "" },
    ),
  ),
});

const config = await runAsync(parser, {
  args: ["--project", "project-api"],
});
~~~~

The synchronous `valibot()` helper remains synchronous and still rejects
schemas that require Valibot's async parse path.  `valibotAsync()` preserves
the same metavar inference, choices, suggestions, formatting, and custom error
handling as `valibot()`.  Fallback values supplied through `bindEnv()` or
`bindConfig()` are validated by the same schema before they are accepted.

Async validation may run during fallback resolution and other repeated parser
paths, including shell completion requests.  Keep remote checks bounded and
cached when possible, and prefer picklist or literal schemas for completion
choices so suggestions stay metadata-driven.


Custom error messages
---------------------

Customize error messages for better user experience:

~~~~ typescript twoslash
import { valibot } from "@optique/valibot";
import { message } from "@optique/core/message";
import * as v from "valibot";
// ---cut-before---
const email = valibot(v.pipe(v.string(), v.email()), {
  placeholder: "",
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
  email: option("--email", valibot(v.pipe(v.string(), v.email()), { placeholder: "" })),
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
      ),
      { placeholder: 0 },
    )
  ),
  logLevel: option(
    "--log-level",
    valibot(v.picklist(["debug", "info", "warn", "error"]), { placeholder: "debug" }),
  ),
  startDate: argument(
    valibot(v.pipe(v.string(), v.transform((s) => new Date(s))), { placeholder: new Date(0) }),
  ),
});
~~~~


Version compatibility
---------------------

The *@optique/valibot* package currently targets Valibot 1.x.


Limitations
-----------

 -  *`valibot()` remains synchronous*: Async Valibot features like
    `pipeAsync()` require `valibotAsync()`.  The sync helper detects schemas
    that need async parsing when possible and throws a `TypeError` instead of
    silently skipping validation.

The Valibot integration provides a lightweight yet powerful way to reuse
validation logic across your entire application while maintaining full type
safety, excellent error messages, and minimal bundle size.

<!-- cSpell: ignore valibot picklist -->
