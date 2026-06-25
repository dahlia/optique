---
description: >-
  Add Clack prompts as fallback for missing CLI arguments.
---

Clack prompts
=============

*This API is available since Optique 1.2.0.*

The *@optique/clack* package wraps any Optique parser with an interactive
[Clack] prompt.  CLI values are used directly; when a value is absent, Clack
asks for it interactively.

This package is built on the shared *@optique/prompt* adapter foundation.  If
you want to connect another prompt library, see
[prompt adapters](./prompt.md).

For a plain Clack-wrapped parser, the fallback priority is:

1.  *CLI argument*
2.  *Clack prompt*

Because Clack prompts are asynchronous, the returned parser always has
`mode: "async"`.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/clack
~~~~

~~~~ bash [npm]
npm add @optique/clack
~~~~

~~~~ bash [pnpm]
pnpm add @optique/clack
~~~~

~~~~ bash [Yarn]
yarn add @optique/clack
~~~~

~~~~ bash [Bun]
bun add @optique/clack
~~~~

:::

[Clack]: https://github.com/bombshell-dev/clack


Basic usage
-----------

Wrap any parser with `prompt()` and provide a prompt configuration object:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";
import { run } from "@optique/run";

const parser = object({
  name: prompt(option("--name", string()), {
    type: "text",
    message: "Project name:",
  }),
  port: prompt(option("--port", integer()), {
    type: "number",
    message: "Port:",
    initialValue: 3000,
  }),
});

await run(parser);
~~~~

When `--name` and `--port` are provided on the command line, prompts are
skipped.  Otherwise Clack asks for the missing values.


Prompt types
------------

### `text` — free-text string

Prompts the user for an arbitrary string value:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const name = prompt(option("--name", string()), {
  type: "text",
  message: "Enter your name:",
  placeholder: "Alice",
  initialValue: "World",
  validate: (value) => value.length > 0 ? undefined : "Name cannot be empty.",
});
~~~~

`text` properties

`message`
:   *(required)* The question to display.

`placeholder`
:   Hint text shown before the user types.

`initialValue`
:   Initial text pre-filled in the prompt.

`validate`
:   Function called when the user submits.  Return a string error message
    to reject and re-prompt, or `undefined`/`void` to accept.

### `confirm` — Boolean yes/no

Prompts the user with a yes/no question:

~~~~ typescript twoslash
import { flag } from "@optique/core/primitives";
import { prompt } from "@optique/clack";

const verbose = prompt(flag("--verbose"), {
  type: "confirm",
  message: "Enable verbose output?",
  initialValue: false,
});
~~~~

`confirm` properties

`message`
:   *(required)* The question to display.

`initialValue`
:   Initial Boolean value.

### `number` — numeric input

Prompts the user for a number:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const port = prompt(option("--port", integer()), {
  type: "number",
  message: "Enter the port:",
  initialValue: 8080,
  min: 1,
  max: 65535,
});
~~~~

Clack does not provide a dedicated number prompt.  *@optique/clack* uses
Clack's `text` prompt, parses the submitted value with `Number()`, and rejects
blank or non-finite values.

`number` properties

`message`
:   *(required)* The question to display.

`placeholder`
:   Hint text shown before the user types.

`initialValue`
:   Initial number shown to the user.

`min`, `max`
:   Accepted value range.

`validate`
:   Additional validation after numeric conversion.  Return a string error
    message to reject and re-prompt, or `undefined`/`void` to accept.

> [!NOTE]
> During interactive use, blank or non-numeric input is rejected by the prompt
> with `Enter a number.` and the user is asked again.  The parse failure
> `No number provided.` is used when a test `prompter` returns `undefined`,
> or when an overridden Clack function returns an invalid final value.

### `password` — masked input

Prompts for a secret value without displaying the characters:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const apiKey = prompt(option("--api-key", string()), {
  type: "password",
  message: "Enter your API key:",
  mask: "*",
  validate: (value) => value.length > 0 ? undefined : "API key is required.",
});
~~~~

`password` properties

`message`
:   *(required)* The question to display.

`mask`
:   Character shown for each typed character.  When omitted, Clack uses its
    default password display behavior.

`validate`
:   Same as `text`.

### `select` — arrow-key single-select

Shows a list where the user selects one option:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const env = prompt(option("--env", string()), {
  type: "select",
  message: "Choose the deployment environment:",
  options: ["development", "staging", "production"],
  initialValue: "development",
});
~~~~

Options can also be objects with display labels and hints:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const color = prompt(option("--color", string()), {
  type: "select",
  message: "Choose a color:",
  options: [
    { value: "red", label: "Red", hint: "warm" },
    { value: "green", label: "Green", hint: "cool" },
    { value: "custom", label: "Custom", disabled: "Coming soon" },
  ],
});
~~~~

`select` properties

`message`
:   *(required)* The question to display.

`options`
:   *(required)* Array of strings or [`Option`] objects.

`initialValue`
:   Initially selected option value.

[`Option`]: #option

### `multiselect` — multi-select

Shows a list where the user selects multiple options:

~~~~ typescript twoslash
import { multiple } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const tags = prompt(multiple(option("--tag", string())), {
  type: "multiselect",
  message: "Select tags:",
  options: ["typescript", "deno", "node", "bun"],
  required: true,
});
~~~~

The inner parser must produce `readonly string[]`, so use `multiple()` around
an option or argument parser.

`multiselect` properties

`message`
:   *(required)* The question to display.

`options`
:   *(required)* Array of strings or [`Option`] objects.

`required`
:   Whether at least one option must be selected.


Prompt-only values
------------------

When a value should *only* come from a prompt (no CLI flag at all), pair
`prompt()` with `fail<T>()`:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { fail } from "@optique/core/primitives";
import { prompt } from "@optique/clack";

const parser = object({
  name: prompt(fail<string>(), {
    type: "text",
    message: "Enter your name:",
  }),
  confirm: prompt(fail<boolean>(), {
    type: "confirm",
    message: "Are you sure?",
    initialValue: false,
  }),
});
~~~~

`fail()` always fails the CLI parse, so the prompt runs unconditionally.


Optional prompts
----------------

Wrap the inner parser with `optional()` to allow the user to skip the prompt
via CLI while still showing a prompt when the flag is absent.  This is
equivalent to any other `prompt()` usage—`optional()` is handled
transparently:

~~~~ typescript twoslash
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const description = prompt(optional(option("--description", string())), {
  type: "text",
  message: "Enter a description (or press Enter to skip):",
});
~~~~

> [!NOTE]
> In this case, if the user just presses Enter at the prompt, the returned
> value is an empty string `""`, not `undefined`.  To get `undefined` when
> the user leaves the field blank, use `validate` to reject empty input or
> handle the empty string in your application.


Composing with other integrations
---------------------------------

`prompt()` composes naturally with `bindEnv()` and `bindConfig()`.  Wrapper
order determines fallback priority.  In the example below, `bindEnv()` is
inside the prompt wrapper, so the environment binding is checked before the
Clack prompt.  This works the same inside `object()`, `tuple()`, `merge()`,
and `concat()`, including dependency-aware `suggest*()` flows.

For example, to fall back to an environment variable before prompting:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt } from "@optique/clack";
import { run } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const parser = object({
  apiKey: prompt(
    bindEnv(option("--api-key", string()), {
      context: envContext,
      key: "API_KEY",
      parser: string(),
    }),
    {
      type: "password",
      message: "Enter your API key:",
      mask: "*",
    },
  ),
});

await run(parser, { contexts: [envContext] });
~~~~

This gives the priority:

CLI argument > Environment variable > Clack prompt


Testing
-------

All prompt configuration types accept an optional `prompter` property for
testing.  When provided, the function is called instead of launching an
interactive Clack prompt:

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const parser = prompt(option("--name", string()), {
  type: "text",
  message: "Enter your name:",
  prompter: () => Promise.resolve("Alice"),  // used in tests
});

const result = await parseAsync(parser, []);
// result.value === "Alice"
~~~~


Cancellation
------------

When Clack reports cancellation through `isCancel()`, *@optique/clack* returns
a parse failure with the message `Prompt cancelled.` instead of throwing.


API reference
-------------

### `prompt(parser, config)`

Wraps a parser with a Clack prompt fallback.

Parameters
:    -  `parser`: The inner parser.  CLI tokens consumed by this parser
        suppress the prompt.
     -  `config`: A [`PromptConfig<T>`] object specifying the prompt type
        and its options.

Returns
:   A new parser with `mode: "async"` and Clack prompt fallback.  The `usage`
    is wrapped in an `optional` term since the prompt handles the
    missing-value case.

[`PromptConfig<T>`]: #promptconfigt

### `PromptConfig<T>`

A conditional type that maps a parser's value type `T` to the appropriate
prompt configuration union:

| Value type          | Accepted config type                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `boolean`           | [`ConfirmConfig`]                                                                                                   |
| `number`            | [`NumberPromptConfig`]                                                                                              |
| `string`            | [`TextConfig`] \| [`PasswordConfig`](#password--masked-input) \| [`SelectConfig`](#select--arrow-key-single-select) |
| `readonly string[]` | [`MultiselectConfig`]                                                                                               |

Optional variants (`boolean | undefined`, `string | undefined`, etc.) map
to the same config types as their non-optional counterparts.

[`ConfirmConfig`]: #confirm--boolean-yesno
[`NumberPromptConfig`]: #number--numeric-input
[`TextConfig`]: #text--free-text-string
[`MultiselectConfig`]: #multiselect--multi-select

### `Option`

An object with `value`, optional `label`, `hint`, and `disabled` fields.
Used in `select` and `multiselect` prompts.


Prompt and inner parser independence
------------------------------------

The CLI path and the prompt path are *independent value sources*.  When
a value comes from the CLI, the inner parser's full constraint pipeline
(value parsing, `choice()` domain checks, `integer({ min, max })`, etc.)
is applied.  When a value comes from a prompt, it is used as-is—the
inner parser's constraints are *not* re-applied.

This design is intentional: combinators like `map()` can transform the
value domain, making the prompted value incompatible with the inner
parser's input path.  Treating the two paths independently avoids false
rejections and keeps the architecture sound.

As a consequence, any runtime validation you need on prompted values
must be configured in the prompt config itself.  Some prompt types
provide a `validate` option for this purpose.

### Matching constraints between CLI and prompt

When the inner parser carries constraints, you should mirror them in the
prompt config.

`number` prompt with `integer()` semantics
:   Use `validate` to reject non-integer numbers, and `min`/`max` to match
    the inner parser's range.

    ~~~~ typescript twoslash
    import { option } from "@optique/core/primitives";
    import { integer } from "@optique/core/valueparser";
    import { prompt } from "@optique/clack";

    const port = prompt(option("--port", integer({ min: 1024, max: 65535 })), {
      type: "number",
      message: "Enter the port:",
      min: 1024,
      max: 65535,
      validate: (value) =>
        Number.isInteger(value) ? undefined : "Must be an integer.",
    });
    ~~~~

`text` prompt with `string({ pattern })` semantics
:   Use `validate` to enforce the same pattern.

    ~~~~ typescript twoslash
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";
    import { prompt } from "@optique/clack";

    const id = prompt(option("--id", string({ pattern: /^[A-Z]{3}-\d+$/ })), {
      type: "text",
      message: "Enter the ID:",
      validate: (value) =>
        /^[A-Z]{3}-\d+$/.test(value) ? undefined : "Must match AAA-123 format.",
    });
    ~~~~

`select` with `choice()` values
:   Keep the prompt `options` array consistent with the inner parser's
    `choice()` domain.  Ensuring this consistency is the caller's
    responsibility.

    ~~~~ typescript twoslash
    import { option } from "@optique/core/primitives";
    import { choice } from "@optique/core/valueparser";
    import { prompt } from "@optique/clack";

    const env = prompt(option("--env", choice(["dev", "staging", "prod"])), {
      type: "select",
      message: "Choose environment:",
      options: ["dev", "staging", "prod"],  // must match choice() values
    });
    ~~~~

`multiselect` with `multiple()` cardinality
:   The `required` option can require at least one selected value.  Clack's
    `multiselect` prompt does not expose a custom `validate` callback here,
    so constraints such as `max` or `min` greater than `1` from `multiple()`
    cannot be enforced at the prompt level.

> [!IMPORTANT]
> `select` and `multiselect` prompt types do not expose a `validate`
> callback.  For these types, there is currently no way to add custom runtime
> validation on prompted values other than disabling individual options or,
> for `multiselect`, setting `required`.


Limitations
-----------

 -  *Always async* — `prompt()` always returns an async parser because Clack
    prompts are asynchronous.  This means any `object()` or other combinator
    containing a `prompt()` parser also becomes async.
 -  *No shell completion* — Interactive prompts do not contribute to shell
    tab-completion suggestions.  Only the wrapped inner parser's suggestions
    are used.
 -  *Single prompt per field* — Each `prompt()` call runs the prompter exactly
    once per parse, even when used inside `object()`.
 -  *TTY required*: Clack requires an interactive terminal (TTY).  In
    non-interactive environments (CI pipelines, piped input), prompts may
    error.  Use the `prompter` override for non-interactive testing.

> [!TIP]
> See the [cookbook](../cookbook.md#combining-with-interactive-prompts) for
> a longer example of the same wrapper order with environment variables and
> configuration files.  The cookbook uses *@optique/inquirer*; for Clack,
> adapt prompt types such as `input` to `text` and `default` to
> `initialValue`.
