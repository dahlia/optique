---
name: optique
description: >
  Use this skill when writing any code that builds a command-line interface
  with Optique in TypeScript or JavaScript. Covers the combinatorial parser
  model, choosing @optique/core vs @optique/run, value parsers, structured
  messages, optional()/withDefault()/multiple(), subcommands with command()
  and or(), shell completion, async parsing, the integration packages, and
  common mistakes to avoid. Trigger whenever the user is parsing command-line
  arguments, building a CLI, or adding options or subcommands to a tool.
license: MIT
---

Start at <https://optique.dev/llms.txt> online; these rules also work offline.


Core rules
----------

 -  Use `run()` from *@optique/run* for apps, `parse()`/`runParser()` to embed.
 -  With `runParser()`, `onError(exitCode, error)` supplies a structured
    `Message`; `help.onShow(exitCode, page)` supplies the final `DocPage`. Both
    follow output. Supply `stdout: () => {}` for custom help rendering. See
    <https://optique.dev/concepts/runners.md#structured-help-callbacks>.
 -  In tests, use `parseArgs()`/`parseArgsSync()` from *@optique/testing/parser*
    for parser results, `captureRun()` from *@optique/testing/run* for runner
    output/exits, `captureProgramRun()` from *@optique/testing/discover* for
    dispatch, and `createCliRunner()` from *@optique/testing/cli* for real CLIs.
    Pin `colors`/`maxWidth` in tests; defaults use terminal and environment.
 -  Compose parsers with `object()`, `tuple()`, `seq()`, `or()`, `merge()`, and
    modifiers. Do not hand-write argument scanners around Optique parsers.
 -  For command/option help headings, set the runner's
    `helpSections: { commands: "Commands", options: "Options" }`.
    It groups untitled entries only on pages with visible commands. See
    <https://optique.dev/cookbook.md#command-and-option-headings-in-help>.
 -  Let TypeScript infer results unless another API needs a separate interface.
 -  Parsers usually require input. `optional(p)` yields `undefined`; use
    `withDefault(p, value)` or `withDefault(flag("-v"), false)` for fallbacks.
 -  Use semantic `message` helpers; keep canonical errors unthemed. Since
    1.3.0, `theme`/`messageFormatter` should preserve `initialWidth`, quoting,
    and width options. `flag()` has static/callback `errors.unexpectedValue`
    since 1.4.0. Mismatch callbacks may be skipped; avoid side effects.
 -  Use value parsers such as `integer()`, `choice()`, `biject()`, `regExp()`,
    `url()`, `origin()`, and `uuid()` instead of validating raw strings after
    parsing. Use `regExp({ flags })` for user-supplied sources, `biject()` for
    one-to-one mappings, `transform()` for mapped results, and
    `choice(values, { key })` for custom string matching that returns the
    declared spelling. Use `normalizeInput()` for raw-string cleanup and
    `path()` from `@optique/run/valueparser` for file-system paths. Write a
    custom value parser only when these tools do not cover the domain.
 -  Since 1.4.0, `-p8080`/`-vp8080` accept attached values. Values consume
    the literal suffix (`-p=5` gives `"=5"`); full single-dash names win.
 -  Async value parsers like *@optique/git* make containing parsers async.
    Await `run()`/`parse()`/`runParser()` or, for `bindKeyring()`, `runAsync()`.
 -  Use `dependency()` when one value parser controls another's valid values.
    For a multi-level chain, wrap the middle derivation too:
    `dependency(source.deriveSync(...))`. Optique resolves such chains by
    dependency order, independently of object/tuple field order.
 -  Use `derivePromptConfig(source, resolver)` from *@optique/prompt* or its
    adapters for choices/messages depending on parsed values; use
    `[sourceA, sourceB]` for several sources. Async resolvers run at fallback
    after sources resolve. Match the prompt kind to the parser's value type;
    derive the CLI parser separately. A lone resolver fetches choices lazily;
    forward its `signal`. Clack `pendingMessage` enables a resolver spinner.
 -  Pass `{ validate, maxAttempts, signal }` as `prompt()`'s third argument.
    Return `undefined` to accept or a structured `Message` to retry, sync/async.
    Attempt limits are positive integers; retries default to unlimited.
    Clack `autocomplete` also has sync native validation; Inquirer `search`
    has sync/async native validation. Multi selections use shared validation.
 -  Clack `autocomplete` filters one selection; `autocomplete-multiselect`
    returns `readonly string[]`. Both take array `options`. Inquirer `search`
    calls `source(term, { signal })` per query; forward the signal to requests.
    Empty search input gives `undefined`.
 -  Implement a custom adapter's `execute(config, context)` so retries can show
    `context.previousValidationMessage`, and forward `context.signal` when the
    prompt library supports aborting active work. Adapter-native validation
    remains separate and completes inside one shared attempt.
 -  Build subcommands with `command()` combined by `or()`; add a literal field
    such as `command: constant("serve")` per branch for a discriminated union.
    Show hidden `aliases` in help with `showAliases` on `command()` or runner.
 -  Use `run(parser, { completion: "both" })` for completion, or the object form
    with `completion.errors` for custom shell errors. Do not hand-write scripts.
 -  Use `usageLine: [{ type: "ellipsis" }]` in runner options when a large root
    synopsis should become a compact `Usage: myapp ...` line. This applies only
    to root full help; use `command()`'s `usageLine` for subcommand help.
 -  Use `showUsage: false` in runner options when full help should show the
    brief and sections without `Usage:`. Set `command()`'s `showUsage: true`
    to restore it; children inherit the nearest explicit ancestor setting.
    Add `commandList: "top-level"` to list only first-level command groups.
 -  Use `termWidth: "auto"` in runner options when descriptions should align
    after the widest visible help term. Optique measures terminal display
    width after adding built-in help/version/completion entries.


Canonical app shape
-------------------

~~~~ typescript
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { argument, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  input: argument(string({ metavar: "FILE" }), {
    description: message`Input file to process.`,
  }),
  port: withDefault(
    option("--port", integer({ min: 1, max: 65535 }), {
      description: message`Port to listen on.`,
    }),
    3000,
  ),
  verbose: withDefault(
    flag("-v", "--verbose", { description: message`Enable verbose logging.` }),
    false,
  ),
});

const config = run(parser, {
  brief: message`Process a file.`,
  completion: "both",
  showDefault: true,
  termWidth: "auto",
});

console.log(`Processing ${config.input} on port ${config.port}.`);
~~~~


Subcommands
-----------

Use `command()` for each branch and `or()` to require exactly one matching
subcommand. Use `optional(or(...))` only when no subcommand is valid.

~~~~ typescript
import { object, or } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import { parse } from "@optique/core/parser";
import { command, constant, flag, option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";

const parser = or(
  command("build", object({
    command: constant("build"),
    watch: withDefault(flag("--watch"), false),
  })),
  command("serve", object({
    command: constant("serve"),
    port: withDefault(option("--port", integer({ min: 1 })), 3000),
  })),
);

const result = parse(parser, ["serve", "--port", "8080"]);

if (result.success) {
  switch (result.value.command) {
    case "build":
      result.value.watch;
      break;
    case "serve":
      result.value.port;
      break;
  }
}
~~~~


Custom value parsers
--------------------

Prefer the built-in catalog first. If a one-to-one dictionary can describe the
input tokens and domain values, use `biject()`. If an existing parser already
accepts the right input syntax, wrap it with `transform()` before writing a
custom parser:

~~~~ typescript
import { biject, choice, transform } from "@optique/core/valueparser";

const exitCode = biject({
  ok: 0,
  warning: 1,
  error: 2,
});

const logLevel = transform(choice(["debug", "info", "warn", "error"] as const), {
  map(value) {
    return value.toUpperCase() as "DEBUG" | "INFO" | "WARN" | "ERROR";
  },
  unmap(value) {
    return value.toLowerCase() as "debug" | "info" | "warn" | "error";
  },
});
~~~~

When a custom domain is needed, keep the validation in a value parser so help,
errors, defaults, prompts, and completion all see the same typed value.

~~~~ typescript
import { message } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";

const levels = ["debug", "info", "warn", "error"] as const;
type Level = typeof levels[number];

function isLevel(input: string): input is Level {
  return (levels as readonly string[]).includes(input);
}

function logLevel(): ValueParser<"sync", Level> {
  return {
    mode: "sync",
    metavar: "LEVEL",
    placeholder: "info",
    parse(input: string): ValueParserResult<Level> {
      if (isLevel(input)) return { success: true, value: input };
      return { success: false, error: message`Invalid log level: ${input}.` };
    },
    format(value: Level): string {
      return value;
    },
  };
}

const parser = logLevel();
~~~~


Common mistakes checklist
-------------------------

 -  Pass parsers to `run()` for apps; use explicit argument arrays with
    `parse()` in tests and embedded use. Do not pre-parse `process.argv`.
 -  Declare only static facts with `defineEmptyInputBehavior()` in
    `@optique/core/extension`; use `inheritEmptyInputBehavior()` for
    transparent wrappers. See [extension APIs].
 -  Do not treat `or(a, b)` as “zero or more alternatives.” Wrap it in
    `optional()` or `withDefault()` to allow no matching branch.
 -  Use `or(command(...), command(...))` for mutually exclusive subcommands.
 -  Wrap required `flag("--x")` in `optional()` or `withDefault(..., false)`.
 -  Do not expect `multiple(p)` to fail when absent; it returns `[]`. Wrap with
    `nonEmpty()` when at least one value is required.
 -  Do not confuse free-order parsing with `seq()`. Most constructs let child
    parsers compete by priority; use `seq()` only for truly ordered grammars.
 -  Use structured `message` values for errors and descriptions.
 -  Register contexts for `bindEnv()`, `bindConfig()`, `bindDerivedDefault()`,
    and `bindKeyring()` in the runner's `contexts` option.
 -  Use `bindEnv().readFallback()` for env/default in error handlers.
 -  Enable `showEnvironment` for env-only help; set `documentation.description`.
 -  Keep multi-level dependency graphs with `dependency()` rather than
    duplicating one-level factories.
 -  Put runtime prompt checks in `when`, with typed `otherwise`; evaluate them
    only at fallback, never eagerly during construction.

For the detailed maintained guide, use <https://optique.dev/pitfalls.md>.

[extension APIs]: https://optique.dev/concepts/extend.md


Reference links
---------------

 -  Documentation index for agents: <https://optique.dev/llms.txt>
 -  Runners and entry points: <https://optique.dev/concepts/runners.md>
 -  Primitive parsers: <https://optique.dev/concepts/primitives.md>
 -  Construct combinators: <https://optique.dev/concepts/constructs.md>
 -  Modifiers: <https://optique.dev/concepts/modifiers.md>
 -  Value parser catalog: <https://optique.dev/concepts/valueparsers.md>
 -  Inter-option dependencies: <https://optique.dev/concepts/dependencies.md>
 -  Structured messages: <https://optique.dev/concepts/messages.md>
 -  Shell completion: <https://optique.dev/concepts/completion.md>
 -  Command discovery: <https://optique.dev/concepts/discover.md>
 -  Man pages: <https://optique.dev/concepts/man.md>


Integration packages
--------------------

| Package                     | Use for                                     | Docs                                                  |
| --------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `@optique/env`              | Environment variable fallbacks              | <https://optique.dev/integrations/env.md>             |
| `@optique/keyring`          | Async OS credential-store password fallback | <https://optique.dev/integrations/keyring.md>         |
| `@optique/config`           | Configuration file fallbacks                | <https://optique.dev/integrations/config.md>          |
| `@optique/derived-defaults` | Defaults computed from first-pass results   | <https://optique.dev/concepts/derived-defaults.md>    |
| `@optique/prompt`           | Generic prompt adapter foundation           | <https://optique.dev/integrations/prompt.md>          |
| `@optique/clack`            | Clack interactive fallback prompts          | <https://optique.dev/integrations/clack.md>           |
| `@optique/inquirer`         | Inquirer.js interactive fallback prompts    | <https://optique.dev/integrations/inquirer.md>        |
| `@optique/standard-schema`  | Portable schema-backed value parsing        | <https://optique.dev/integrations/standard-schema.md> |
| `@optique/zod`              | Zod-backed value parsing                    | <https://optique.dev/integrations/zod.md>             |
| `@optique/valibot`          | Valibot-backed value parsing                | <https://optique.dev/integrations/valibot.md>         |
| `@optique/temporal`         | Temporal date and time parsers              | <https://optique.dev/integrations/temporal.md>        |
| `@optique/git`              | Async Git reference validation              | <https://optique.dev/integrations/git.md>             |
| `@optique/logtape`          | LogTape levels and formatter/output options | <https://optique.dev/integrations/logtape.md>         |
| `@optique/man`              | Man page generation                         | <https://optique.dev/concepts/man.md>                 |
| `@optique/discover`         | File-based command discovery                | <https://optique.dev/concepts/discover.md>            |
| `@optique/testing`          | Layered CLI testing at a chosen boundary    | <https://optique.dev/concepts/testing.md>             |
