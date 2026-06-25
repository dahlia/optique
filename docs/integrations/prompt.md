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
`bindEnv()` and `bindConfig()` can satisfy values before prompting, usage is
marked optional, completion and suggestion behavior is preserved, and the
returned parser is always async.

Wrapper order determines source-binding priority.  With the source binding
inside the prompt wrapper, the fallback priority is:

1.  *CLI argument*
2.  *Source binding such as environment variables or config files*
3.  *Prompt adapter*

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


When to use this package
------------------------

Use *@optique/prompt* when you are publishing or maintaining a prompt
integration package.  A normal application should usually depend on a concrete
integration:

 -  *@optique/clack* for Clack prompts
 -  *@optique/inquirer* for Inquirer.js prompts

The shared wrapper exists so each integration does not need to reimplement the
same parser semantics.  Your integration supplies a config type and an
`execute()` function; *@optique/prompt* supplies the `prompt(parser, config)`
wrapper.


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

The generated wrapper is a fluent async parser, so it still supports modifier
methods such as `map()`:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

interface PromptConfig {
  readonly value: string;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    return { success: true, value: config.value as TValue };
  },
});

const upperName = prompt(option("--name", string()), {
  value: "Alice",
}).map((value) => value.toUpperCase());

upperName.mode;
//        ^? const upperName: import("@optique/core/fluent").FluentParser<"async", string, unknown>
~~~~


Writing an adapter
------------------

An adapter usually has three layers:

 -  *Config types*: Public types that match the prompt library's terminology.
 -  *Execution mapping*: Code that calls the prompt library and translates its
    result into Optique's `ValueParserResult<TValue>` shape.
 -  *Wrapper export*: The `prompt()` function returned by
    `createPromptAdapter()`.

The config type can be as narrow or broad as your prompt library requires.  A
small string-only adapter might look like this:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { createPromptAdapter } from "@optique/prompt";

interface TextConfig {
  readonly type: "text";
  readonly message: string;
  readonly default?: string;
  readonly promptText: (message: string) => Promise<string | null>;
}

export const prompt = createPromptAdapter<TextConfig>({
  async execute<TValue>(config: TextConfig) {
    const value = await config.promptText(config.message);
    if (value == null) {
      return { success: false, error: message`Prompt cancelled.` };
    }
    return { success: true, value: value as TValue };
  },
});
~~~~

Concrete integrations can keep their own naming conventions.  For example,
*@optique/inquirer* uses Inquirer-style `input` and `checkbox` names, while
*@optique/clack* uses Clack-style `text` and `multiselect` names.


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

### Prompt failures and thrown errors

Use a failed `ValueParserResult` for expected prompt outcomes that should be
reported as parse failures:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { createPromptAdapter } from "@optique/prompt";

interface PromptConfig {
  readonly cancelled: boolean;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    if (config.cancelled) {
      return { success: false, error: message`Prompt cancelled.` };
    }
    return { success: true, value: "value" as TValue };
  },
});
~~~~

Let unexpected prompt-library errors throw.  The generated parser does not
turn thrown exceptions into parse failures; they propagate to the caller.


Generated parser behavior
-------------------------

The generated `prompt(parser, config)` wrapper preserves the inner parser's
shape while changing how missing values are completed.

### CLI values skip prompting

The inner parser is tried first.  If it consumes CLI tokens, its completed
value is used and the adapter is not called:

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

const calls: string[] = [];
interface PromptConfig {
  readonly value: string;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    calls.push(config.value);
    return { success: true, value: config.value as TValue };
  },
});

const parser = prompt(option("--name", string()), { value: "Prompted" });
const result = await parseAsync(parser, ["--name", "Alice"]);

// result.value === "Alice"
// calls.length === 0
~~~~

### Source bindings can skip prompting

When the wrapped parser is also bound to another source, that source is checked
before prompting.  This lets concrete prompt integrations compose with
`bindEnv()` and `bindConfig()`:

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { createPromptAdapter } from "@optique/prompt";

const envContext = createEnvContext({
  prefix: "MYAPP_",
  source: (key) => ({ MYAPP_NAME: "EnvName" })[key],
});
const annotations = envContext.getAnnotations();

interface PromptConfig {
  readonly value: string;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    return { success: true, value: config.value as TValue };
  },
});

const parser = prompt(
  bindEnv(option("--name", string()), {
    context: envContext,
    key: "NAME",
    parser: string(),
  }),
  { value: "PromptName" },
);

if (!(annotations instanceof Promise)) {
  const result = await parseAsync(parser, [], { annotations });
  // result.value === "EnvName"
}
~~~~

This gives the priority:

CLI argument > Environment variable > Prompt adapter

### Missing values run the adapter

If the inner parser does not consume CLI tokens and no source binding supplies
a value, the adapter runs during completion:

~~~~ typescript twoslash
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

interface PromptConfig {
  readonly value: string;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    return { success: true, value: config.value as TValue };
  },
});

const parser = prompt(option("--name", string()), { value: "Bob" });
const result = await parseAsync(parser, []);

// result.value === "Bob"
~~~~

### Prompt-only values

When a value should *only* come from a prompt, wrap `fail<T>()`:

~~~~ typescript twoslash
import { fail } from "@optique/core/primitives";
import { createPromptAdapter } from "@optique/prompt";

interface PromptConfig {
  readonly value: string;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    return { success: true, value: config.value as TValue };
  },
});

const secret = prompt(fail<string>(), { value: "from prompt" });
~~~~

`fail()` always fails the CLI parse, so the adapter runs unconditionally.

### Optional and repeated values

The wrapper works with parser modifiers such as `optional()` and `multiple()`:

~~~~ typescript twoslash
import { multiple, optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

interface PromptConfig {
  readonly value: unknown;
}

const prompt = createPromptAdapter<PromptConfig>({
  async execute<TValue>(config: PromptConfig) {
    return { success: true, value: config.value as TValue };
  },
});

const description = prompt(optional(option("--description", string())), {
  value: "prompted description",
});

const tags = prompt(multiple(option("--tag", string())), {
  value: ["typescript", "deno"],
});
~~~~

For repeated values, your prompt config type should return the same value
shape as the wrapped parser, such as `readonly string[]` for
`multiple(option("--tag", string()))`.


Defaults and documentation
--------------------------

`getDefaultValue(config)` affects documentation fragments, not parse fallback
behavior.  It lets an integration pass a prompt-level default to the wrapped
parser so generated help can show it consistently.

If `getDefaultValue` is omitted, *@optique/prompt* reads a `default` property
from object-shaped configs:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

interface ConfigWithDefault {
  readonly message: string;
  readonly default?: string;
}

const prompt = createPromptAdapter<ConfigWithDefault>({
  async execute<TValue>(config: ConfigWithDefault) {
    return { success: true, value: (config.default ?? "") as TValue };
  },
});

const name = prompt(option("--name", string()), {
  message: "Name:",
  default: "Alice",
});
~~~~

Use `getDefaultValue` when your prompt library uses another property name,
such as Clack's `initialValue`:

~~~~ typescript twoslash
import { createPromptAdapter } from "@optique/prompt";

interface ConfigWithInitialValue {
  readonly message: string;
  readonly initialValue?: string;
}

const prompt = createPromptAdapter<ConfigWithInitialValue>({
  async execute<TValue>(config: ConfigWithInitialValue) {
    return { success: true, value: (config.initialValue ?? "") as TValue };
  },
  getDefaultValue(config: ConfigWithInitialValue) {
    return config.initialValue;
  },
});
~~~~

> [!NOTE]
> `withDefault()` inside a prompt wrapper does not replace the prompt fallback.
> Missing CLI values still run the adapter.  Put prompt defaults in your prompt
> config and expose them with `getDefaultValue()` when you want them reflected
> in help text.


Prompt and inner parser independence
------------------------------------

The CLI path and the prompt path are *independent value sources*.  When
a value comes from the CLI, the inner parser's full constraint pipeline
(value parsing, `choice()` domain checks, `integer({ min, max })`, etc.)
is applied.  When a value comes from a prompt, it is whatever your adapter
returns.

This is intentional: prompt libraries usually already validate prompted
values, and combinators like `map()` can transform the value domain in ways
that are not valid CLI input.  Your integration should validate prompted
values before returning `{ success: true, value }`.

For example, a number prompt adapter should parse and validate the prompt's
string result before returning a number:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { createPromptAdapter } from "@optique/prompt";

interface NumberConfig {
  readonly message: string;
  readonly promptText: (message: string) => Promise<string>;
}

const promptNumber = createPromptAdapter<NumberConfig>({
  async execute<TValue>(config: NumberConfig) {
    const text = await config.promptText(config.message);
    const value = Number(text);
    if (!Number.isFinite(value)) {
      return { success: false, error: message`Enter a number.` };
    }
    return { success: true, value: value as TValue };
  },
});
~~~~


Suggestions and usage
---------------------

The generated parser delegates shell-completion suggestions to the wrapped
parser.  Prompt-only values do not add new shell-completion suggestions.

Usage is also based on the wrapped parser, but *@optique/prompt* wraps the
usage in an optional term when needed.  This prevents help text from implying
that a missing CLI value is always an error, because the prompt can supply the
value interactively.

The wrapper preserves parser metadata used by dependency-aware completions and
`suggest*()` flows.  Concrete integrations normally do not need to handle this
metadata themselves.


Testing adapters
----------------

You can test concrete integrations without a TTY by putting an injectable
prompt function into your config, or by adding an explicit testing escape hatch
such as `prompter`.

The core behavior to test is:

 -  CLI values skip prompt execution.
 -  Missing CLI values call `execute()`.
 -  Source bindings such as `bindEnv()` skip prompt execution.
 -  Prompt failures are returned as parse failures.
 -  Multiple prompt fields run in parser order.

A minimal test adapter can record calls:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { parseAsync } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

interface TestConfig<TValue> {
  readonly value: TValue;
  readonly reject?: boolean;
}

const calls: TestConfig<unknown>[] = [];
const prompt = createPromptAdapter<TestConfig<unknown>>({
  async execute<TValue>(config: TestConfig<unknown>) {
    calls.push(config);
    if (config.reject === true) {
      return { success: false, error: message`Prompt rejected.` };
    }
    return { success: true, value: config.value as TValue };
  },
});

const parser = prompt(option("--name", string()), { value: "Prompted" });
await parseAsync(parser, ["--name", "Alice"]);

// calls.length === 0
~~~~


API reference
-------------

### `createPromptAdapter(adapter)`

Creates a `prompt(parser, config)` wrapper for one prompt library.

Parameters
:   `adapter`: A [`PromptAdapter<TConfig>`](#promptadaptertconfig) that
    executes prompts for your library.

Returns
:   A function that wraps any parser and always returns a
    `FluentParser<"async", TValue, TState>`.

### `PromptAdapter<TConfig>`

Adapter object accepted by `createPromptAdapter()`.

`execute(config)`
:   Executes the library-specific prompt and returns a
    `Promise<ValueParserResult<TValue>>`.

`getDefaultValue(config)`
:   Optional function that returns a prompt-level default for documentation
    fragments.


Implementation checklist
------------------------

When adding a concrete prompt integration, make sure it:

 -  Exports a library-specific `prompt()` created with `createPromptAdapter()`.
 -  Uses prompt type names that match the underlying library.
 -  Returns failed `ValueParserResult` values for expected outcomes such as
    cancellation.
 -  Throws only for unexpected prompt-library failures.
 -  Validates and converts prompted values before returning success.
 -  Exposes prompt-level defaults through `getDefaultValue()` if the library
    does not use a `default` config property.
 -  Provides a TTY-free testing path.
