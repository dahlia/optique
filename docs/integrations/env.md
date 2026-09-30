---
description: >-
  Bind parser fields to environment variables with type-safe parsing and
  fallback behavior.
---

Environment variable support
============================

*This API is available since Optique 1.0.0.*

The *@optique/env* package lets you bind parser values to environment
variables while preserving Optique's type safety and parser composition model.

The fallback priority is:

1.  CLI argument
2.  Environment variable
3.  *.env* file value
4.  Default value
5.  Error

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/env
~~~~

~~~~ bash [npm]
npm add @optique/env
~~~~

~~~~ bash [pnpm]
pnpm add @optique/env
~~~~

~~~~ bash [Yarn]
yarn add @optique/env
~~~~

~~~~ bash [Bun]
bun add @optique/env
~~~~

:::


Basic usage
-----------

### 1. Create an environment context

~~~~ typescript twoslash
import { createEnvContext } from "@optique/env";

const envContext = createEnvContext({
  prefix: "MYAPP_",
});
~~~~

You can also provide a custom source function for tests or custom runtimes:

~~~~ typescript twoslash
import { createEnvContext } from "@optique/env";

const mockEnv: Record<string, string> = {
  MYAPP_HOST: "test.example.com",
};

const envContext = createEnvContext({
  prefix: "MYAPP_",
  source: (key) => mockEnv[key],
});
~~~~

To load *.env* files as an internal fallback layer, pass `envFile`:

~~~~ typescript twoslash
import { createEnvContext } from "@optique/env";

const envContext = createEnvContext({
  prefix: "MYAPP_",
  envFile: [".env", ".env.local"],
});
~~~~

Values from *.env* files are read by `bindEnv()` but are not written to
`process.env` or `Deno.env`.  Real environment variables still take
priority over file values.

### 2. Bind parsers to environment keys

~~~~ typescript twoslash
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const host = bindEnv(option("--host", string()), {
  context: envContext,
  key: "HOST",
  parser: string(),
  default: "localhost",
});

const port = bindEnv(option("--port", integer()), {
  context: envContext,
  key: "PORT",
  parser: integer(),
  default: 3000,
});

const verbose = bindEnv(option("--verbose"), {
  context: envContext,
  key: "VERBOSE",
  parser: bool(),
  default: false,
});
~~~~

### 3. Run with contexts

Use `run()`, `runSync()`, or `runAsync()` from *@optique/run* with
`contexts: [envContext]`.

> [!WARNING]
> `bindEnv()` only reads environment variables when its context is registered
> with the runner.  If you omit `contexts: [envContext]` from the `run()` call,
> the env lookup is silently skipped and the parser falls back to the default
> or fails with an error indicating the context was not registered.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const parser = object({
  host: bindEnv(option("--host", string()), {
    context: envContext,
    key: "HOST",
    parser: string(),
    default: "localhost",
  }),
  port: bindEnv(option("--port", integer()), {
    context: envContext,
    key: "PORT",
    parser: integer(),
    default: 3000,
  }),
  verbose: bindEnv(option("--verbose"), {
    context: envContext,
    key: "VERBOSE",
    parser: bool(),
    default: false,
  }),
});

const result = await runAsync(parser, {
  contexts: [envContext],
});
~~~~


Reading a fallback after a parse error
--------------------------------------

Keep a reference to a parser returned by `bindEnv()` to read its environment
fallback in an error handler. `readFallback()` reads the environment variable
or configured default without using a CLI value from the failed parse. It
returns a result that may itself be a failure, for example when the environment
value is invalid. An async bound parser returns a promise.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { runWith } from "@optique/core/facade";
import { formatMessage } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { choice, integer } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";

const levels = ["error", "warn", "debug"] as const;
const envContext = createEnvContext({ prefix: "APP_" });
const logLevel = bindEnv(option("--log-level", choice(levels)), {
  context: envContext,
  key: "LOG_LEVEL",
  parser: choice(levels),
  default: "warn",
});

await runWith(
  object({ logLevel, topN: option("--top-n", integer()) }),
  "app",
  [envContext],
  {
    args: ["--top-n", "x"],
    stderr: () => {},
    onError: (_, error) => {
      const fallback = logLevel.readFallback();
      if (fallback.success) {
        console.error(`${fallback.value}: ${formatMessage(error)}`);
      } else {
        console.error(formatMessage(fallback.error));
      }
    },
  },
);
~~~~

`readFallback()` reads the source when called, even if the context was not
registered for a parse. If the environment variable is absent and there is
no default, it reports a missing variable. It does not continue into a
wrapped config or prompt parser's fallback.


Boolean values
--------------

`bool()` parses common environment Boolean literals (case-insensitive):

 -  true values: `"true"`, `"1"`, `"yes"`, `"on"`
 -  false values: `"false"`, `"0"`, `"no"`, `"off"`

~~~~ typescript twoslash
import { bool } from "@optique/env";

const parser = bool();
~~~~


*.env* files
------------

`envFile` accepts `true`, a path string, an array of paths, or an options
object:

~~~~ typescript twoslash
import { createEnvContext } from "@optique/env";

const envContext = createEnvContext({
  prefix: "MYAPP_",
  envFile: {
    paths: [".env", ".env.local"],
    substitute: (command) =>
      command === "whoami" ? "developer" : undefined,
  },
});
~~~~

Passing `true` loads only *.env* from the current working directory.
When several paths are provided, files are loaded in order and later
files override earlier file values.  Missing files are skipped.

The parser supports common dotenv syntax:

 -  blank lines and comments
 -  optional `export` prefixes
 -  `KEY=VALUE` assignments
 -  single-quoted, double-quoted, and unquoted values
 -  multiline quoted values
 -  inline comments after unquoted values
 -  `$VAR` and `${VAR}` expansion

Single-quoted values are literal.  Optique does not expand variables,
perform command substitution, or interpret escape sequences inside
single quotes.

Double-quoted and unquoted values expand variables in a single
left-to-right pass.  Expansion reads from the configured `source` first,
then from values already loaded from *.env* files.  Missing variables
expand to the empty string.

Optique recognizes `$(...)` and backtick command-substitution forms, but
it never executes commands by itself.  If `substitute` is provided, Optique
passes the command text to that hook and inserts the returned string.  If
the hook is absent or returns `undefined`, the substitution becomes the
empty string.

Encrypted dotenvx values are not decrypted; they are treated as ordinary
string values.


Help and man page documentation
-------------------------------

*This feature is available since Optique 1.4.0.*

`bindEnv()` records each full variable name (`prefix + key`) in the wrapped
parser's documentation. Enable `showEnvironment` to display those names:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { run } from "@optique/run";

const context = createEnvContext({ prefix: "APP_" });
const levels = choice(["error", "warn", "debug"], { metavar: "LEVEL" });
const parser = object({
  logLevel: bindEnv(
    option("--log-level", levels, {
      description: message`Diagnostic verbosity.`,
    }),
    { context, key: "LOG_LEVEL", parser: levels, default: "warn" },
  ),
});

await run(parser, {
  contexts: [context],
  help: "option",
  showDefault: true,
  showEnvironment: { placement: "both" },
});
~~~~

The help includes an inline annotation and a separate section:

~~~~ text
  --log-level LEVEL           Diagnostic verbosity. ["warn"] [env: APP_LOG_LEVEL]

Environment:
  APP_LOG_LEVEL               --log-level LEVEL
~~~~

| `showEnvironment`          | Output                                                                 |
| -------------------------- | ---------------------------------------------------------------------- |
| Omitted or `false`         | No automatic environment output                                        |
| `true` or `{}`             | Inline annotations; a section for names without visible CLI references |
| `{ placement: "section" }` | An Environment section                                                 |
| `{ placement: "both" }`    | Annotations and a section                                              |

Set `sectionTitle` in the options object to customize the generated heading.
The section follows the regular help sections, before examples; `sectionOrder`
only sorts the regular sections. Names shared by several entries appear once,
with references to the associated options or arguments. Hidden documentation
entries are excluded, and subcommand pages use their existing documentation
scope. A term hidden only from usage still appears in documentation.

These names describe declared bindings. They do not guarantee that every
variable is consulted on every parse: an outer binding's default can prevent
an inner binding from being reached. Nested bindings list outer names first,
without duplicate names. A binding around a composite parser is associated
with all its visible entries, rather than declaring a separate fallback for
each child. When alternative branches document the same CLI option, the
existing first-entry-wins deduplication also chooses its environment metadata.

Names and any explicitly supplied purpose text are displayed. Creating this
metadata does not add reads of environment values. Context registration is
still required for parsing, but the names can be documented without registering
the context.

Man page generators accept the same `showEnvironment` option. See
[Environment documentation](../concepts/man.md#environment-documentation)
for automatic sections and manual overrides.

### Custom renderers

`getDocPage()` exposes the names as `DocEntry.envVars`, an optional readonly
array. Independent bindings appear in the optional readonly
`DocPage.environmentBindings` array as `EnvironmentBindingDoc` records with
`name`, optional `description`, and optional `hidden` fields. Hidden records
are excluded from pages before `help.onShow` receives them. Existing
documentation entries retain their shape when no binding is
attached, but entries from `bindEnv()` gain this field even when automatic
output is disabled. Exact object comparisons or serialized documentation
snapshots may need updating.

The generated section is not inserted into `DocPage.sections`, including the
page supplied to a runner's `help.onShow` callback. Use
`deriveEnvironmentSection()` from *@optique/core/doc* to obtain it separately:

~~~~ typescript twoslash
import type { Parser } from "@optique/core/parser";
declare const parser: Parser<"sync", unknown, unknown>;
// ---cut-before---
import { deriveEnvironmentSection } from "@optique/core/doc";
import { getDocPage } from "@optique/core/parser";

const page = getDocPage(parser);
const environment = page == null
  ? undefined
  : deriveEnvironmentSection(page, { title: "Environment variables" });
~~~~

The helper returns `undefined` when no visible names exist. It creates a new
`DocSection` without modifying the page. Environment entries refer to the
associated CLI terms and include explicitly supplied environment purposes;
they do not copy CLI descriptions, defaults, or choices. Empty names and
empty CLI terms are omitted. Names with CLI references come first in entry
order, followed by unreferenced names in binding order. Unique purposes are
joined with line breaks; references follow a `CLI:` label when a purpose is
present. Generated purposes render value terms without quotes.

Pass `{ onlyUnreferenced: true }` to collect only names without any visible
CLI reference on this page, as the inline fallback does. The helper groups
names exactly and deduplicates structurally equal purposes. A hidden record
never hides a separate visible binding of the same name.


Env-only values
---------------

If a value should come only from environment (or default), pair `bindEnv()`
with `fail<T>()`:

~~~~ typescript twoslash
import { bindEnv, createEnvContext } from "@optique/env";
import { fail } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const timeout = bindEnv(fail<number>(), {
  context: envContext,
  key: "TIMEOUT",
  parser: integer(),
  default: 30,
  documentation: { description: message`Request timeout in seconds.` },
});
~~~~

With `showEnvironment: true`, this binding appears in a separate Environment
section without a fake option or argument:

~~~~ text
Environment:
  MYAPP_TIMEOUT               Request timeout in seconds.
~~~~

`fail()` and `constant()` declare a source-only documentation scope. Built-in
combinators preserve it when every documented child declares it and the scope
is visible. An empty fragment list alone does not grant this capability: a
hidden CLI option also has no entries. Custom parsers can declare
`DocFragments.sourceOnly: true`; custom wrappers must forward it and
`environmentBindings` while respecting their own visibility and branch scope.
See
[source-only documentation](../concepts/extend.md#source-only-documentation).

The default inline layout adds a section only for names without visible CLI
references. A name shared by an env-only binding and a visible CLI binding
appears only inline; use `section` or `both` to show its purpose as well.
A purpose is optional, and a name-only binding still appears in the section.
Defaults and current values are never inferred into these entries.

`documentation.description` also describes CLI-bound environment variables,
without replacing the CLI description. It produces an independent purpose
record when a visible CLI entry exists. The purpose is stored
separately from the CLI entry. If `or()`/`longestMatch()` first-entry-wins
deduplication removes that entry, the purpose can still appear in the fallback
section. Without a purpose, the existing
CLI metadata follows the deduplicated entry.

Set `documentation.hidden` to `true`, `"doc"`, or `"help"` to hide this binding
from both automatic forms. `false` and `"usage"` remain visible in help.
This setting does not hide the CLI option itself, change parsing, or expose
an enclosing hidden parser. Nested bindings retain their own visibility.


Composing with other contexts
-----------------------------

Environment context is a regular `SourceContext`, so it composes naturally
with configuration contexts.  The *outermost* wrapper is checked first
during completion, so nesting order determines fallback priority.
Wrapping as `bindEnv(bindConfig(option(...)))` gives:

CLI argument > Environment variable > Config file > Default value

~~~~ typescript twoslash
import { z } from "zod";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createConfigContext, bindConfig } from "@optique/config";
import { bindEnv, createEnvContext } from "@optique/env";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({
  schema: z.object({ host: z.string() }),
});

const parser = object({
  config: option("--config", string()),
  host: bindEnv(
    bindConfig(option("--host", string()), {
      context: configContext,
      key: "host",
      default: "localhost",
    }),
    {
      context: envContext,
      key: "HOST",
      parser: string(),
    },
  ),
});

await runAsync(parser, {
  contexts: [envContext, configContext],
  contextOptions: {
    getConfigPath: (parsed) => parsed.config,
  },
});
~~~~


Prefix and key resolution
-------------------------

When `bindEnv()` looks up an environment variable, it concatenates the
context's `prefix` with the `key` you pass.  For example:

| `prefix`   | `key`      | Looked-up variable |
| ---------- | ---------- | ------------------ |
| `"MYAPP_"` | `"HOST"`   | `MYAPP_HOST`       |
| `"MYAPP_"` | `"PORT"`   | `MYAPP_PORT`       |
| `""`       | `"EDITOR"` | `EDITOR`           |

If you omit `prefix` (or pass `""`), the key is used as-is.  This is useful
when binding to well-known variables like `EDITOR` or `HOME` that have no
application-specific prefix:

~~~~ typescript twoslash
import { bindEnv, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const envContext = createEnvContext();  // no prefix

const editor = bindEnv(option("--editor", string()), {
  context: envContext,
  key: "EDITOR",
  parser: string(),
  default: "vi",
});
~~~~


Using other value parsers
-------------------------

The `parser` option in `bindEnv()` accepts any Optique `ValueParser`.
Because environment variables are always strings, the value parser converts
the raw string into the target type.  All built-in value parsers from
*@optique/core* work here:

~~~~ typescript twoslash
import { bindEnv, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { port, url, string } from "@optique/core/valueparser";

const envContext = createEnvContext({ prefix: "MYAPP_" });

// Parse as a URL
const apiUrl = bindEnv(option("--api-url", url()), {
  context: envContext,
  key: "API_URL",
  parser: url(),
});

// Parse as a port number (validated range 0–65535)
const listenPort = bindEnv(option("--port", port()), {
  context: envContext,
  key: "PORT",
  parser: port(),
  default: 8080,
});
~~~~

You can also use value parsers from integration packages such as
*@optique/zod* or *@optique/valibot* if you need richer validation:

~~~~ typescript twoslash
import { z } from "zod";
import { bindEnv, createEnvContext } from "@optique/env";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { zod } from "@optique/zod";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const logLevel = bindEnv(
  option(
    "--log-level",
    zod(
      z.enum(["debug", "info", "warn", "error"]),
      { placeholder: "debug" },
    ),
  ),
  {
    context: envContext,
    key: "LOG_LEVEL",
    parser: zod(
      z.enum(["debug", "info", "warn", "error"]),
      { placeholder: "debug" },
    ),
    default: "info" as const,
  },
);
~~~~


Error handling
--------------

### Missing environment variable

When the environment variable is not set and no `default` is provided,
`bindEnv()` falls through to the wrapped parser's `complete()` result.
This means the final error message depends on the wrapped parser (or other
wrappers such as `bindConfig()`), rather than always being an environment-
specific error.

If a `default` is provided, the default is used silently.

### Invalid value

When the environment variable is set but the value parser rejects it,
the error from the value parser propagates directly.  For example, if
`MYAPP_PORT` is set to `"abc"` and the parser is `integer()`:

~~~~ text
Expected an integer, but received "abc".
~~~~

Similarly, `bool()` rejects unrecognized literals:

~~~~ text
Invalid Boolean value: "maybe". Expected one of "true", "1", "yes", "on",
"false", "0", "no", or "off"
~~~~

### Fallback validation

Since Optique 1.0.0, fallback values produced by `bindEnv()` are
re-validated against the inner CLI parser's constraints (regex patterns,
numeric bounds, `choice()` values, etc.).  This applies to both
environment variable values—which may have been parsed by a looser
env-level `parser` option—and to the configured `default`.

For example, the following parser rejects the default `"abc"` because
it does not match the inner CLI pattern `/^[A-Z]+$/`:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";

const envContext = createEnvContext({ prefix: "MYAPP_" });
// ---cut-before---
bindEnv(option("--name", string({ pattern: /^[A-Z]+$/ })), {
  context: envContext,
  key: "NAME",
  parser: string(), // looser than the inner parser
  default: "abc", // rejected at runtime: must match /^[A-Z]+$/
});
~~~~

Validation is forwarded through standard combinators (`optional()`,
`withDefault()`, `group()`, `command()`) and through wrapping
`bindEnv()`/`bindConfig()` layers, so a constraint defined on a deeply
nested primitive is still enforced against a fallback value.

`multiple()` attaches its own `validateValue`: it enforces the
configured `min`/`max` arity against the fallback array length and,
*if* the inner parser exposes a `validateValue` hook, walks each
element through it.  Arity enforcement is unconditional—it kicks in
even when the inner parser has no `validateValue`—and a non-array
fallback (for example a mis-typed default escaped through `as never`)
is rejected outright because `multiple()` can never produce a
non-array shape from CLI input.

`nonEmpty()` is a pure pass-through: it does not add an extra
non-empty check on the fallback path.  On the CLI path `nonEmpty()`
still enforces that at least one token was consumed, but on fallback
values `nonEmpty(multiple(...))` delegates entirely to the inner
`multiple()`'s arity rules.  If you need a “must have at least one
element” guarantee against fallback arrays, use
`multiple(..., { min: 1 })` directly.

`map()`, `derive()`, and `deriveFrom()` intentionally *strip* the
inner parser's `validateValue`: the mapping function is one-way, so
the mapped output type no longer corresponds to the inner parser's
constraints, and derived value parsers rebuild from *default*
dependency values rather than the live-resolved ones.  Wrapping an
inner parser in any of these suppresses revalidation of the wrapped
primitive's constraints—but outer combinators layered above
(notably `multiple()`) still enforce their own checks.

### Help, version, and completion

Like config contexts, environment contexts work seamlessly with help,
version, and completion features.  Genuine help, version, and
completion requests are handled before environment variable lookup, so
`--help` still works even when required environment variables are
missing, unless the user parser already consumes that same token
sequence as ordinary data:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const parser = object({
  apiKey: bindEnv(option("--api-key", string()), {
    context: envContext,
    key: "API_KEY",
    parser: string(),
    // No default — required from CLI or env
  }),
});

await runAsync(parser, {
  contexts: [envContext],
  help: "option",
  version: "1.0.0",
});
~~~~


API reference
-------------

### `createEnvContext(options?)`

Creates an environment context for use with Optique runners.

Parameters
:    -  `options.prefix`: String prefix prepended to all keys when looking
        up environment variables.  Defaults to `""`.
     -  `options.source`: Custom function `(key: string) => string | undefined`
        for reading environment values.  Defaults to `Deno.env.get` on Deno
        and `process.env` on Node.js/Bun.
     -  `options.envFile`: Optional *.env* file fallback layer.  Pass `true`
        to load *.env*, a path string, an array of paths, or an object with
        `paths` and `substitute`.

Returns
:   `EnvContext` implementing `SourceContext` and `Disposable`.

> [!IMPORTANT]
> If you call `envContext.getAnnotations()` manually, pass the returned
> object to low-level APIs such as `parse()`, `parseAsync()`,
> `parser.complete()`, `suggest()`, or `getDocPage()`. Environment contexts
> are single-pass, so calling `getAnnotations()` without a request still
> reads the final snapshot. Calling it alone does not affect later parses.

### `bindEnv(parser, options)`

Binds a parser to environment variables with fallback priority
(CLI > environment > default > error).

Fallback values—environment variable values and the configured
`default`—are re-validated against the inner CLI parser's constraints,
so constraints like `integer({ min })`, `string({ pattern })`, and
`choice([...])` cannot be bypassed through an environment variable or
default.  See *Fallback validation* under “Error handling” for details.

Parameters
:    -  `parser`: The inner parser to wrap.
     -  `options.context`: `EnvContext` to read from.
     -  `options.key`: Environment variable key *without* the prefix. The actual
        variable looked up is `prefix + key`.
     -  `options.documentation`: Optional purpose `description` and
        documentation `hidden` visibility. See
        [env-only values](#env-only-values).
     -  `options.parser`: A `ValueParser` used to parse the raw string value
        from the environment.
     -  `options.default`: Optional default value used when neither CLI
        nor environment provides a value.

Returns
:   A new parser with environment fallback behavior and a
    `readFallback()` method. The method reads only the environment variable
    or default, applies the wrapped parser's validation when available, and
    returns a `ValueParserResult` (or a promise for an async parser).

### `bool(options?)`

Creates a synchronous `ValueParser<"sync", boolean>` that accepts common
Boolean literals (case-insensitive).

Parameters
:    -  `options.metavar`: Metavariable name shown in help text.
        Defaults to `"BOOLEAN"`.
     -  `options.errors.invalidFormat`: Custom error message or function
        for unrecognized input.

Returns
:   `ValueParser<"sync", boolean>`

### `EnvContext`

Interface extending `SourceContext` with two additional properties:

 -  `prefix`: The prefix string passed to `createEnvContext()`
 -  `source`: The `EnvSource` function used to read variables


Limitations
-----------

 -  *String-only input* — Environment variables are always strings, so a
    `parser` is required in every `bindEnv()` call to convert the raw string
    into the target type.  Unlike `bindConfig()`, there is no way to skip
    the parser.
 -  *Flat keys only* — Environment variables have no native nesting structure.
    Unlike config files, you cannot use accessor functions to navigate nested
    objects.  Use naming conventions (e.g., `DB_HOST`, `DB_PORT`) to
    represent structure.
 -  *No schema validation* — Unlike *@optique/config*, there is no schema that
    validates the set of environment variables as a whole.  Each binding is
    validated independently.
 -  *No automatic dotenv conventions* — `envFile: true` loads only *.env*.
    Optique does not automatically load *.env.local*, *.env.development*,
    or framework-specific file sets.
 -  *No built-in command execution* — Command-substitution syntax is
    recognized only so applications can opt in with `envFile.substitute`.
    Without that hook, command substitutions become empty strings.
 -  *No dotenvx decryption* — Encrypted values remain ordinary strings.
 -  *Synchronous reads*: `createEnvContext()` reads environment variables
    and *.env* files synchronously.  The context itself does not add async
    overhead, but if the `parser` used in `bindEnv()` is async, the overall
    parsing becomes async.

> [!TIP]
> See the [cookbook](../cookbook.md#environment-variable-fallbacks) for
> additional patterns, including
> [combining env with config files](../cookbook.md#combining-with-environment-variables)
> and
> [env-only values with `fail()`](../cookbook.md#config-only-and-env-only-values-with-fail).
