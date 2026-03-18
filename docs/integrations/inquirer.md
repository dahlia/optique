---
description: >-
  Add interactive prompts as fallback for missing CLI arguments using
  Inquirer.js.
---

Interactive prompts
===================

*This API is available since Optique 1.0.0.*

The *@optique/inquirer* package wraps any Optique parser with an interactive
[Inquirer.js] prompt.  When the user provides a value via CLI, that value is
used directly.  When the argument is absent, an interactive prompt is shown
instead of failing.

The fallback priority is:

1.  *CLI argument*
2.  *Interactive prompt*

Because interactive prompts are inherently asynchronous, the returned parser
always has `$mode: "async"`.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/inquirer
~~~~

~~~~ bash [npm]
npm add @optique/inquirer
~~~~

~~~~ bash [pnpm]
pnpm add @optique/inquirer
~~~~

~~~~ bash [Yarn]
yarn add @optique/inquirer
~~~~

~~~~ bash [Bun]
bun add @optique/inquirer
~~~~

:::

[Inquirer.js]: https://github.com/SBoudrias/Inquirer.js


Basic usage
-----------

Wrap any parser with `prompt()` and provide a prompt configuration object:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";
import { run } from "@optique/run";

const parser = object({
  name: prompt(option("--name", string()), {
    type: "input",
    message: "Enter your name:",
  }),
  port: prompt(option("--port", integer()), {
    type: "number",
    message: "Enter the port number:",
    default: 3000,
  }),
});

await run(parser);
~~~~

When `--name` and `--port` are provided on the command line, the prompts are
skipped.  When they are absent, the user sees interactive prompts.


Prompt types
------------

### `input` — free-text string

Prompts the user for an arbitrary string value:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const name = prompt(option("--name", string()), {
  type: "input",
  message: "Enter your name:",
  default: "World",
  validate: (value) => value.length > 0 || "Name cannot be empty.",
});
~~~~

`input` properties

`message`
:   *(required)* The question to display.

`default`
:   Pre-filled text shown in the input field.

`validate`
:   Function called when the user submits.  Return `true` to accept or
    a string error message to reject and re-prompt.

### `confirm` — Boolean yes/no

Prompts the user with a yes/no question:

~~~~ typescript twoslash
import { flag } from "@optique/core/primitives";
import { prompt } from "@optique/inquirer";

const verbose = prompt(flag("--verbose"), {
  type: "confirm",
  message: "Enable verbose output?",
  default: false,
});
~~~~

`confirm` properties

`message`
:   *(required)* The question to display.

`default`
:   Default answer when the user presses Enter without typing.

### `number` — numeric input

Prompts the user for a number:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const port = prompt(option("--port", integer()), {
  type: "number",
  message: "Enter the port:",
  default: 8080,
  min: 1,
  max: 65535,
});
~~~~

`number` properties

`message`
:   *(required)* The question to display.

`default`
:   Default number shown to the user.

`min`, `max`
:   Accepted value range.

`step`
:   Granularity of valid values.  Use `"any"` for arbitrary decimals.

> [!NOTE]
> If the user submits the prompt without entering a number (leaving it blank),
> the result is a parse failure rather than `undefined`.

### `password` — masked input

Prompts for a secret value without displaying the characters:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const apiKey = prompt(option("--api-key", string()), {
  type: "password",
  message: "Enter your API key:",
  mask: true,
});
~~~~

`password` properties

`message`
:   *(required)* The question to display.

`mask`
:   When `true`, show `*` for each keystroke.  When `false` or omitted,
    input is completely hidden.

`validate`
:   Same as `input`.

### `editor` — multi-line text

Opens the user's `$VISUAL` or `$EDITOR` for multi-line input:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const message = prompt(option("--message", string()), {
  type: "editor",
  message: "Write your commit message:",
  default: "",
  validate: (value) => value.trim().length > 0 || "Message cannot be empty.",
});
~~~~

`editor` properties

`message`
:   *(required)* The question to display.

`default`
:   Content pre-filled in the editor buffer.

`validate`
:   Same as `input`.

### `select` — arrow-key single-select

Shows a scrollable list where the user selects one option using arrow keys:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const env = prompt(option("--env", string()), {
  type: "select",
  message: "Choose the deployment environment:",
  choices: ["development", "staging", "production"],
  default: "development",
});
~~~~

Choices can also be objects with display names and descriptions:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt, Separator } from "@optique/inquirer";

const color = prompt(option("--color", string()), {
  type: "select",
  message: "Choose a color:",
  choices: [
    { value: "red", name: "Red", description: "A warm primary color" },
    { value: "green", name: "Green", description: "A cool secondary color" },
    new Separator("──────────"),
    { value: "custom", name: "Custom…", disabled: "Coming soon" },
  ],
});
~~~~

`select` properties

`message`
:   *(required)* The question to display.

`choices`
:   *(required)* Array of strings, [`Choice`] objects, or `Separator`
    instances.

`default`
:   Initially highlighted choice value.

[`Choice`]: #choice

### `rawlist` — numbered list

Shows a numbered list and prompts the user to type a number:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const format = prompt(option("--format", string()), {
  type: "rawlist",
  message: "Choose the output format:",
  choices: ["json", "yaml", "toml"],
});
~~~~

`rawlist` properties

`message`
:   *(required)* The question to display.

`choices`
:   *(required)* Array of strings or [`Choice`] objects.

`default`
:   Pre-selected choice value.

### `expand` — keyboard shortcut single-select

Prompts the user to press a single key to select an option:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const action = prompt(option("--action", string()), {
  type: "expand",
  message: "What do you want to do?",
  choices: [
    { value: "overwrite", name: "Overwrite", key: "o" },
    { value: "skip", name: "Skip", key: "s" },
    { value: "abort", name: "Abort", key: "a" },
  ],
});
~~~~

`expand` properties

`message`
:   *(required)* The question to display.

`choices`
:   *(required)* Array of [`ExpandChoice`] objects, each with a single
    lowercase alphanumeric `key`.

`default`
:   Default choice key.

[`ExpandChoice`]: #expandchoice

### `checkbox` — multi-select

Shows a scrollable list where the user toggles multiple options with Space:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { multiple } from "@optique/core/modifiers";
import { prompt } from "@optique/inquirer";

const tags = prompt(multiple(option("--tag", string())), {
  type: "checkbox",
  message: "Select tags:",
  choices: ["typescript", "deno", "node", "bun"],
});
~~~~

The inner parser must produce `readonly string[]`, so use `multiple()` around
an option or argument parser.

`checkbox` properties

`message`
:   *(required)* The question to display.

`choices`
:   *(required)* Array of strings, [`Choice`] objects, or `Separator`
    instances.


Prompt-only values
------------------

When a value should *only* come from a prompt (no CLI flag at all), pair
`prompt()` with `fail<T>()`:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { fail } from "@optique/core/primitives";
import { prompt } from "@optique/inquirer";

const parser = object({
  name: prompt(fail<string>(), {
    type: "input",
    message: "Enter your name:",
  }),
  confirm: prompt(fail<boolean>(), {
    type: "confirm",
    message: "Are you sure?",
    default: false,
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
import { option } from "@optique/core/primitives";
import { optional } from "@optique/core/modifiers";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const description = prompt(optional(option("--description", string())), {
  type: "input",
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

`prompt()` composes naturally with `bindEnv()` and `bindConfig()`.  The
innermost wrapper is evaluated first, so nesting order determines fallback
priority.

For example, to fall back to an environment variable before prompting:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt } from "@optique/inquirer";
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
      mask: true,
    },
  ),
});

await run(parser, { contexts: [envContext] });
~~~~

This gives the priority:

CLI argument > Environment variable > Interactive prompt


Testing
-------

All prompt configuration types accept an optional `prompter` property for
testing.  When provided, the function is called instead of launching an
interactive Inquirer.js prompt:

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { prompt } from "@optique/inquirer";

const parser = prompt(option("--name", string()), {
  type: "input",
  message: "Enter your name:",
  prompter: () => Promise.resolve("Alice"),  // used in tests
});

const result = await parseAsync(parser, []);
// result.value === "Alice"
~~~~


API reference
-------------

### `prompt(parser, config)`

Wraps a parser with an interactive prompt fallback.

Parameters
:    -  `parser`: The inner parser.  CLI tokens consumed by this parser
        suppress the prompt.
     -  `config`: A [`PromptConfig<T>`] object specifying the prompt type
        and its options.

Returns
:   A new parser with `$mode: "async"` and interactive prompt fallback.
    The `usage` is wrapped in an `optional` term since the prompt handles
    the missing-value case.

[`PromptConfig<T>`]: #promptconfigt

### `PromptConfig<T>`

A conditional type that maps a parser's value type `T` to the appropriate
prompt configuration union:

| Value type          | Accepted config type                                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `boolean`           | [`ConfirmConfig`]                                                                                                                                                                                                                                                              |
| `number`            | [`NumberPromptConfig`]                                                                                                                                                                                                                                                         |
| `string`            | [`InputConfig`] \| [`PasswordConfig`](#password--masked-input) \| [`EditorConfig`](#editor--multi-line-text) \| [`SelectConfig`](#select--arrow-key-single-select) \| [`RawlistConfig`](#rawlist--numbered-list) \| [`ExpandConfig`](#expand--keyboard-shortcut-single-select) |
| `readonly string[]` | [`CheckboxConfig`]                                                                                                                                                                                                                                                             |

Optional variants (`boolean | undefined`, `string | undefined`, etc.) map
to the same config types as their non-optional counterparts.

[`ConfirmConfig`]: #confirm--boolean-yesno
[`NumberPromptConfig`]: #number--numeric-input
[`InputConfig`]: #input--free-text-string
[`CheckboxConfig`]: #checkbox--multi-select

### `Choice`

An object with `value`, optional `name`, `description`, `short`, and
`disabled` fields.  Used in `select`, `rawlist`, and `checkbox` prompts.

### `ExpandChoice`

Like [`Choice`] but requires a `key` field (single lowercase alphanumeric
character).  Used in `expand` prompts.

### `Separator`

Re-exported from Inquirer.js.  Use `new Separator(text?)` to add visual
dividers in `select` and `checkbox` choice lists.


Limitations
-----------

 -  *Always async* — `prompt()` always returns an async parser because
    Inquirer.js prompts are inherently asynchronous.  This means any `object()`
    or other combinator containing a `prompt()` parser also becomes async.
 -  *No shell completion* — Interactive prompts do not contribute to shell
    tab-completion suggestions.  Only the wrapped inner parser's suggestions
    are used.
 -  *Single prompt per field* — Each `prompt()` call runs the prompter
    exactly once per parse, even when used inside `object()`.
 -  *No inner-parser constraint enforcement on prompted values* — Prompted
    values bypass the inner parser's constraint pipeline (e.g.,
    `integer({ min, max })` or `string({ pattern })`).  The prompter returns
    a value of type `TValue` directly, which may belong to a different domain
    than the inner parser's input — for example, when `map()` transforms the
    value.  To validate prompted input at runtime, use the prompt config's
    `validate` option.
 -  *TTY required* — Inquirer.js requires an interactive terminal (TTY).
    In non-interactive environments (CI pipelines, piped input), prompts
    will error.  Use the `prompter` override for non-interactive testing.
