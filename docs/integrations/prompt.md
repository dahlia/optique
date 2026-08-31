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











// `upperName` is a fluent async parser
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

### Runtime conditions can skip prompting

Add `when` and `otherwise` to a prompt config when the fallback depends on a
runtime capability.  `when` can return a Boolean or a promise of one.  When it
returns `false`, the adapter is not called and `otherwise` becomes the parsed
value:

~~~~ typescript twoslash
declare function canPromptSecurely(): Promise<boolean>;
// ---cut-before---
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

const parser = prompt(option("--token", string()), {
  value: "prompted token",
  when: canPromptSecurely,
  otherwise: "",
});

const result = await parseAsync(parser, []);
~~~~

The condition is evaluated only when an actual parse reaches the prompt
fallback.  CLI values, source bindings, help, version output, completion
probes, and shell suggestions do not run it.  Each fallback evaluates its
condition at most once per parse.  A thrown or rejected condition error
propagates to the caller; it is not treated as prompt cancellation or a parse
failure.

`otherwise` is a static value with the parser's result type.  It is returned
as-is, without running the inner parser's validation or normalization, and it
is not used as a documented default.

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


Dependency sources
------------------

*This behavior is available since Optique 1.3.0.*

When `prompt()` wraps a [dependency source](../concepts/dependencies.md), the
prompted value registers in the dependency runtime, so parsers derived from
that source observe the value the user actually selected.  A derived parser
behaves identically whether its dependency value came from the command line,
a source binding, or an interactive prompt.

To make the value available before derived parsers re-evaluate, a
dependency-source prompt runs earlier than ordinary prompts: source prompts
run serially in declaration order before dependency replay, while non-source
prompts keep running after the other fields complete.  As a consequence, a
dependency-source prompt may be displayed before a non-source prompt declared
earlier in the same object.  Structural precedence applies per field: a
prompted field whose own value already came from the command line or a
source binding does not prompt, while another prompted field sharing the
same source still does, and its answer registers last.

Each source prompt runs at most once per parse operation, and never during
help, shell suggestion, or probe phases.  When the user cancels a source
prompt, the parse fails immediately and later prompts do not run.  A source
prompt transformed with `map()` registers its pre-transform value, and a
source prompt nested in a child construct (such as a `concat()` child tuple)
still completes before sibling consumers.  A source prompt wrapped in
`optional()` follows `optional()`'s suppression: an unmatched field
resolves to `undefined` without prompting, just as for a non-source
prompt.  Note the direction of `map()`: `prompt(...).map(...)` registers
the pre-transform prompt answer, while `prompt()` around an
already-transformed source cannot recover the pre-transform value and
registers nothing.  When distinct prompts wrap the
same source in duplicate `merge()` fields, each prompt runs in its own
child and the later field's value wins, as with other duplicate fields.
Likewise, when several prompted fields share one dependency source, every
prompt runs and the last occurrence's value registers, matching how
repeated command-line source occurrences overwrite earlier ones.

Under `runWith()` with two-pass source contexts, a source prompt runs at most
once per run.  During the phase-two seed pass it runs only when another
parser's command-line input demands the source value; otherwise it defers to
the final pass, and phase-two contexts see the field as deferred.

Inside a `conditional()`, a prompted source discriminator and the
prompted sources of the selected branch both run before sibling derived
parsers re-evaluate, even when nothing on the command line selects a
branch: the discriminator's answer resolves the branch once, and the
same selection is reused when the conditional completes.  A prompted
discriminator that does not wrap a dependency source cannot take part in
this early resolution, so the branch it selects prompts only during the
conditional's own completion.

One pre-existing limitation carries over: a prompt used directly as an
`or()`/`longestMatch()` branch never executes when no command-line input
matches, because the parse fails before any branch is chosen.  Prompts
inside a branch still run once other input commits that branch.

Concrete integrations built on `createPromptAdapter()` get this behavior
automatically.


Derived prompt configurations
-----------------------------

*This API is available since Optique 1.3.0.*

`derivePromptConfig()` derives a prompt configuration from one or more
dependency source values, so a later prompt can adapt its question to
earlier answers.  The resolver may return the configuration synchronously
or asynchronously, and it runs immediately before the adapter executes,
inside the same effectful completion as the prompt itself:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { createPromptAdapter, derivePromptConfig } from "@optique/prompt";

interface SelectConfig {
  readonly message: string;
  readonly choices: readonly string[];
}

declare function promptSelect(config: SelectConfig): Promise<string>;
// ---cut-before---
const prompt = createPromptAdapter<SelectConfig>({
  async execute<TValue>(config: SelectConfig) {
    return { success: true, value: await promptSelect(config) as TValue };
  },
});

const framework = dependency(choice(["fresh", "hono"] as const));
const packageManager = dependency(choice(["deno", "npm", "pnpm"] as const));

const parser = object({
  framework: prompt(option("--framework", framework), {
    message: "Web framework:",
    choices: ["fresh", "hono"],
  }),
  packageManager: prompt(
    option("--package-manager", packageManager),
    derivePromptConfig(framework, (value) => ({
      message: "Package manager:",
      choices: value === "fresh" ? ["deno"] : ["npm", "pnpm"],
    })),
  ),
});
~~~~

The named sources must publish their values before the resolver runs, so
the scheduler orders prompts by the dependency graph: in the example
above, the framework prompt always runs before the package manager
prompt, even if the fields were declared in the opposite order.
Declaration order still breaks ties between independent prompts.  A
configuration may also read several sources at once by passing a tuple;
the resolver then receives the values as a tuple in the same order.

The resolver does not care where a dependency value came from: the
command line, a source binding, a `withDefault()` fallback, and an
interactive prompt all publish real values.  When a source has published
nothing, the configuration's own declared default applies instead:

 -  With `defaultValue` (or `defaultValues` for a tuple), the resolver
    receives the lazily evaluated fallback, and its context reports
    `usedDefault: true` (or the matching `usedDefaults` position) so the
    resolver can distinguish an actual answer from a fallback.
 -  Without a declared default, an unpublished dependency fails the
    prompt with a diagnostic naming the missing source; the resolver and
    the adapter never run.

Failures follow the same rules as a cancelled prompt.  A resolver that
throws or rejects fails the prompt, and when the prompt is also a
dependency source, the failure propagates to its consumers with the full
dependency chain in the diagnostic.  A failed upstream source likewise
fails the prompt before the resolver runs.  Mutually dependent
configurations are rejected with a circular dependency error.

The optional third argument accepts the same `when`/`otherwise` pair as
static configurations, evaluated before the resolver, so a skipped
prompt performs no configuration work.  Note that upstream sources may
already have prompted by then: the condition skips this prompt's own
question, not the dependency resolution that scheduled before it.

Because probes, help, and suggestions never run resolvers, generated
documentation cannot reflect a derived configuration.  `getDocFragments`
falls back to the wrapped parser's static metadata, and the adapter's
`getDefaultValue()` is never called with a derived configuration.

Under `runWith()` with two-pass source contexts, a prompt with a derived
configuration whose wrapped parser is *not* a dependency source defers
during the phase-two seed pass and resolves in the final pass, after
every source has published.  If phase-two contexts need its value, make
the wrapped parser a source with `dependency()`.

Derived configurations also work inside a `conditional()` whose branch
is selected only during completion.  The scheduler aggregates the
completion dependencies of every selectable branch, so the conditional
waits for the sources a branch configuration reads even when they are
declared *after* the conditional, and the demand-only seed pass of a
`runWith()` run reaches a prerequisite only through the branch consumer
that actually reads it.  Three caveats follow from the branch estimates
being static.  A dependency on a source that another sibling might
publish, such as a completion consumer next to a conditional whose
branch consumes the sibling's own source, can be rejected as a circular
dependency even though only one of them would run.  A branch that
*could* provide a source itself—through an unselected nested
alternative, or an `optional()` occurrence that ends up parsing
nothing—resolves that source inside the branch, so a matching provider
declared after the conditional is not waited for and the configuration
falls back to its declared default.  And a speculative selection that
the discriminator ultimately rejects may already have demanded its
configuration prerequisites, so a prerequisite prompt can run before
the branch-mismatch error surfaces, although the rejected branch's own
resolver never runs.


Testing adapters
----------------

You can test concrete integrations without a TTY by putting an injectable
prompt function into your config, or by adding an explicit testing escape hatch
such as `prompter`.

The core behavior to test is:

 -  CLI values skip prompt execution.
 -  Missing CLI values call `execute()`.
 -  Source bindings such as `bindEnv()` skip prompt execution.
 -  Runtime conditions run only at the real prompt fallback.
 -  A false runtime condition returns `otherwise` without calling `execute()`.
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
    `FluentParser<"async", TValue, TState>`.  Its config accepts the adapter's
    fields together with [`PromptCondition<TValue>`](#promptconditiontvalue),
    or a [`DerivedPromptConfig`](#derivepromptconfigsource-resolver-options)
    whose resolver returns the adapter's config type.

### `PromptCondition<TValue>`

Shared runtime condition fields accepted by every generated prompt wrapper.
Provide both fields or neither:

`when`
:   A function returning `boolean` or `Promise<boolean>`.  The prompt runs
    when the result is `true`.

`otherwise`
:   The typed value returned when `when` resolves to `false`.

### `PromptAdapter<TConfig>`

Adapter object accepted by `createPromptAdapter()`.

`execute(config)`
:   Executes the library-specific prompt and returns a
    `Promise<ValueParserResult<TValue>>`.

`getDefaultValue(config)`
:   Optional function that returns a prompt-level default for documentation
    fragments.  Never called with a derived configuration.

### `derivePromptConfig(source, resolver, options?)`

*Available since Optique 1.3.0.*

Creates a `DerivedPromptConfig` that resolves the adapter configuration
from dependency source values during the real completion phase.

Parameters
:   `source`: A dependency source created with `dependency()`, or a
    non-empty tuple of such sources.

:   `resolver`: Receives the source value (or the tuple of values) and a
    context object, and returns the adapter configuration synchronously or
    as a promise.  The single-source context has `usedDefault: boolean`;
    the tuple context has a positional `usedDefaults` tuple.  A flag is
    `true` only when the value came from this configuration's own declared
    default, not from source-level fallbacks such as `withDefault()`.

:   `options`: Optional `defaultValue` (or `defaultValues` for a tuple)
    thunk evaluated lazily for unpublished sources, plus the same
    `when`/`otherwise` pair as static configurations.

Returns
:   An opaque `DerivedPromptConfig` accepted by every `prompt()` wrapper
    generated by `createPromptAdapter()`.

Throws
:   `TypeError` when `source` is empty or contains a value that is not a
    dependency source.

### `isDerivedPromptConfig(config)`

*Available since Optique 1.3.0.*

Returns whether a prompt configuration was created by
`derivePromptConfig()`.  Adapters that inspect config objects (for
example, in a custom `getDefaultValue()`) can use it to skip the derived
marker, although *@optique/prompt* already never passes the marker to
adapter callbacks.


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
 -  Accepts `derivePromptConfig()` results in its public `prompt()`
    signature, typed so the resolver returns the integration's own config
    union.
 -  Provides a TTY-free testing path.
