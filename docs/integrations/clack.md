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

### `text`—free-text string

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

### `confirm`—Boolean yes/no

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

### `number`—numeric input

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

### `password`—masked input

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

### `select`—arrow-key single-select

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

### `multiselect`—multi-select

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


Conditional prompt skipping
---------------------------

Use `when` with a matching `otherwise` value when a prompt depends on a
runtime capability.  This example asks about GitHub CLI integration only when
the `gh` executable is available:

~~~~ typescript twoslash
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fail } from "@optique/core/primitives";
import { prompt } from "@optique/clack";

const execFileAsync = promisify(execFile);

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const useGitHubCli = prompt(fail<boolean>(), {
  type: "confirm",
  message: "Use GitHub CLI?",
  initialValue: true,
  when: () => commandExists("gh"),
  otherwise: false,
});
~~~~

The condition runs only when an actual parse reaches this fallback.  CLI
values and configured sources take priority without running it, and Optique
also skips it while generating help, version output, or shell completion.
When `when` returns `false`, `otherwise` is returned without opening Clack.  If
the condition throws or rejects, the error propagates to the caller.


Shared validation, retries, and cancellation
--------------------------------------------

*This API is available since Optique 1.3.0.*

Pass a third options argument to `prompt()` to validate any value returned by
Clack, including `select` and `multiselect` results.  The validator returns a
structured [`Message`](../concepts/messages.md) to reject the value, or
`undefined` to accept it:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const environment = prompt(option("--environment", string()), {
  type: "select",
  message: "Choose the deployment environment:",
  options: ["development", "production"],
}, {
  validate: async (value) => {
    await Promise.resolve();
    return value === "production"
      ? undefined
      : message`Production access is required.`;
  },
  maxAttempts: 3,
});
~~~~

The validator may be synchronous or asynchronous.  When it rejects a value,
the prompt runs again and Clack displays the preceding validation message
before opening the next prompt.  `maxAttempts` limits the number of Clack
executions in that completion and must be a positive integer.  It defaults to
unlimited retries; when the limit is exhausted, parsing fails with the last
validation message.

Configuration-level `validate` fields on `text`, `password`, and `number` are
native Clack validation.  They run within one Clack execution and can reject
several submissions without consuming another shared attempt.  The third
argument's shared validator runs once after Clack returns a value.

Pass an `AbortSignal` as `signal` to stop an active prompt or validator.  An
abort rejects parsing with the signal's exact `reason`; it is not converted to
a `Prompt cancelled.` failure.  CLI values, configured sources, and skipped
runtime conditions do not consult these shared options because no prompt
attempt runs.


Testing
-------

All prompt configuration types accept an optional `prompter` property for
testing.  When provided, the function is called instead of launching an
interactive Clack prompt.  It receives the one-based `attempt`, the
`previousValidationMessage` from the preceding shared validation failure, and
the shared `signal`:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/clack";

const parser = prompt(option("--name", string()), {
  type: "text",
  message: "Enter your name:",
  prompter: ({ attempt }) =>
    Promise.resolve(attempt === 1 ? "taken" : "Alice"),
}, {
  validate: (value) => value === "taken"
    ? message`That name is already taken.`
    : undefined,
});

const result = await parseAsync(parser, []);
// result.value === "Alice"
~~~~

A custom `prompter` replaces the Clack UI completely, so the adapter does not
log `previousValidationMessage` automatically.  The function can inspect or
display that message itself.  Each invocation is one shared attempt.


Cancellation
------------

When Clack reports cancellation through `isCancel()`, *@optique/clack* returns
a parse failure with the message `Prompt cancelled.` instead of throwing.  If
an `AbortSignal` caused Clack to cancel while closing its UI, parsing instead
rejects with that signal's exact reason.


Dependency-derived configurations
---------------------------------

*This API is available since Optique 1.3.0.*

`derivePromptConfig()`, re-exported from *@optique/prompt*, derives a
prompt configuration from [dependency source](../concepts/dependencies.md)
values, so a later question can adapt its options to earlier answers:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { derivePromptConfig, prompt } from "@optique/clack";

const framework = dependency(choice(["fresh", "hono"] as const));
const packageManager = choice(["deno", "npm", "pnpm"] as const);

const parser = object({
  framework: prompt(option("--framework", framework), {
    type: "select",
    message: "Web framework:",
    options: [{ value: "fresh" }, { value: "hono" }],
  }),
  packageManager: prompt(
    option("--package-manager", packageManager),
    derivePromptConfig(framework, (value) => ({
      type: "select",
      message: "Package manager:",
      options: (value === "fresh" ? ["deno"] : ["npm", "pnpm"])
        .map((name) => ({ value: name })),
    })),
  ),
});
~~~~

This changes the options shown by the prompt, not the values accepted from the
command line: `--package-manager deno` is still valid with `--framework hono`.
If the framework should also constrain CLI input, derive the wrapped value
parser from `framework`.  Wrap that derived parser with `dependency()` only
when its result must serve another dependency consumer.

The resolver may be synchronous or asynchronous and runs right before the
prompt opens, after the named sources have published their values—whether
they came from the command line, a binding, or another prompt.  See the
[*@optique/prompt* documentation](./prompt.md#derived-prompt-configurations)
for declared defaults, failure behavior, and the runtime condition form.


API reference
-------------

### `prompt(parser, config, options?)`

Wraps a parser with a Clack prompt fallback.

Parameters
:    -  `parser`: The inner parser.  CLI tokens consumed by this parser
        suppress the prompt.
     -  `config`: A [`PromptConfig<T>`] object specifying the prompt type
        and its options, or a configuration derived from dependency
        sources with `derivePromptConfig()` (re-exported from
        *@optique/prompt* since 1.3.0).  A derived configuration's
        resolver may return any [`RuntimePromptConfig`] member; see the
        [*@optique/prompt* documentation](./prompt.md#derived-prompt-configurations)
        for the resolver contract.
     -  `options`: Optional shared [`PromptOptions<T>`] with `validate`,
        `maxAttempts`, and `signal`.  These options apply after the adapter
        returns a prompted value, independently of config-level native
        validation.

Returns
:   A new parser with `mode: "async"` and Clack prompt fallback.  The `usage`
    is wrapped in an `optional` term since the prompt handles the
    missing-value case.

`PromptOptions`, `PromptValidator`, and `PromptExecutionContext` are
re-exported from *@optique/prompt* for callers that need to name these types.

[`PromptConfig<T>`]: #promptconfigt
[`RuntimePromptConfig`]: #runtimepromptconfig
[`PromptOptions<T>`]: ./prompt.md#promptoptionstvalue

### `PromptConfig<T>`

A conditional type that maps a parser's value type `T` to the appropriate
prompt configuration union.  Every variant also accepts either both `when`
and `otherwise`, or neither.  `when` may be synchronous or asynchronous, and
`otherwise` must match `T`.

| Value type          | Accepted config type                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `boolean`           | [`ConfirmConfig`]                                                                                                 |
| `number`            | [`NumberPromptConfig`]                                                                                            |
| `string`            | [`TextConfig`] \| [`PasswordConfig`](#password—masked-input) \| [`SelectConfig`](#select—arrow-key-single-select) |
| `readonly string[]` | [`MultiselectConfig`]                                                                                             |

Optional variants (`boolean | undefined`, `string | undefined`, etc.) map
to the same config types as their non-optional counterparts.

[`ConfirmConfig`]: #confirm—boolean-yes-no
[`NumberPromptConfig`]: #number—numeric-input
[`TextConfig`]: #text—free-text-string
[`MultiselectConfig`]: #multiselect—multi-select

### `RuntimePromptConfig`

*Available since Optique 1.3.0.*

The union of every prompt configuration this package can execute,
regardless of the parser value type.  A `derivePromptConfig()` resolver
returns a member of this union; the per-value-type narrowing of
[`PromptConfig<T>`] applies only to static configurations.
The resolver must therefore return a prompt kind whose result has the wrapped
parser's value type.  For example, do not return a `number` configuration for a
parser that produces a string.  See
[Prompt and inner parser independence](#prompt-and-inner-parser-independence).

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

As a consequence, runtime constraints that should apply to both paths must be
declared for each path.  Use config-level native validation when the prompt
type supports it, and use the third argument's shared `validate` option for
validation after any prompt type returns a value.

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
    `choice()` domain.  Shared validation can additionally reject a selected
    value at runtime.

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
:   The native `required` option can require at least one selected value.  Use
    shared validation for other constraints such as a maximum or a minimum
    greater than one.

> [!IMPORTANT]
> Shared validation applies only to prompted values.  It does not re-run the
> wrapped parser's value parser, modifiers, or mappings.


Limitations
-----------

 -  *Always async* — `prompt()` always returns an async parser because Clack
    prompts are asynchronous.  This means any `object()` or other combinator
    containing a `prompt()` parser also becomes async.
 -  *No shell completion* — Interactive prompts do not contribute to shell
    tab-completion suggestions.  Only the wrapped inner parser's suggestions
    are used.
 -  *Per-occurrence caching* — A reached `prompt()` occurrence runs its
    prompter once per shared attempt, so validation can invoke it several
    times.  The terminal result is still cached across internal completion
    passes.  Reusing one prompt parser at several positions creates a separate
    occurrence at each position.
 -  *TTY required*: Clack requires an interactive terminal (TTY).  In
    non-interactive environments (CI pipelines, piped input), prompts may
    error.  Use the `prompter` override for non-interactive testing.

> [!TIP]
> See the [cookbook](../cookbook.md#combining-with-interactive-prompts) for
> a longer example of the same wrapper order with environment variables and
> configuration files.  The cookbook uses *@optique/inquirer*; for Clack,
> adapt prompt types such as `input` to `text` and `default` to
> `initialValue`.
