---
description: >-
  Build prompt-library integrations for Optique with a generic adapter API.
---

Prompt adapters
===============

*This API is available since Optique 1.2.0.*

The *@optique/prompt* package provides the shared parser wrapper used by
interactive prompt integrations.  Most applications should use
*@optique/inquirer* or *@optique/clack* directly.  Reach for this package when
you want to connect Optique to another prompt library.

The adapter controls only prompt execution.  *@optique/prompt* handles the
parser behavior: CLI values take priority, source bindings such as
`bindEnv()` and `bindConfig()` can satisfy values before prompting, and the
returned parser is always async.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/prompt
~~~~

~~~~ bash [npm]
npm add @optique/prompt
~~~~

~~~~ bash [pnpm]
pnpm add @optique/prompt
~~~~

~~~~ bash [Yarn]
yarn add @optique/prompt
~~~~

~~~~ bash [Bun]
bun add @optique/prompt
~~~~

:::


Basic usage
-----------

Create an adapter with `createPromptAdapter()`, then use the returned
`prompt()` wrapper around any parser:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

interface DemoPromptConfig {
  readonly message: string;
  readonly value: string;
}

const prompt = createPromptAdapter<DemoPromptConfig>({
  async execute<TValue>(config: DemoPromptConfig) {
    // A real adapter would call a prompt library here.
    return { success: true, value: config.value as TValue };
  },
});

const name = prompt(option("--name", string()), {
  message: "Name:",
  value: "Alice",
});
~~~~

If `--name Alice` is provided on the command line, the adapter is not called.
If the CLI value is absent, the adapter runs during parser completion.


Adapter contract
----------------

`createPromptAdapter(adapter)` accepts a small object:

`execute(config)`
:   Runs the prompt library and returns a `ValueParserResult<TValue>`.
    Return `{ success: true, value }` for a prompted value, or
    `{ success: false, error }` for a prompt-level failure such as
    cancellation.

`getDefaultValue(config)`
:   *(optional)* Returns a config default for documentation fragments.  If it
    is omitted, object configs with a `default` property use that value.

Concrete integrations can keep their own config types.  For example,
*@optique/inquirer* uses Inquirer-style `input` and `checkbox` names, while
*@optique/clack* uses Clack-style `text` and `multiselect` names.
