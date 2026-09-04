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

Optique is a type-safe combinatorial CLI parser. Use it by describing the CLI
grammar with parsers and combinators, not by manually walking `argv`.

If web access is available, start from <https://optique.dev/llms.txt> for the
maintained documentation index. Keep the rules below in mind even when offline;
they cover the parts agents most often get wrong.


Core rules
----------

 -  Use `run()` from *@optique/run* for applications; use `parse()` or
    `runParser()` for embedded and custom runtimes.
 -  In tests, use `parseArgs()`/`parseArgsSync()` from *@optique/testing/parser*
    for structured parser results, or `captureRun()` from
    *@optique/testing/run* for runner-rendered output and exits.
 -  Compose parsers with `object()`, `tuple()`, `seq()`, `or()`, `merge()`, and
    modifiers. Do not write imperative `if`/`else` argument scanners around
    Optique parsers.
 -  Let TypeScript infer the parsed value type from the parser. Do not
    hand-maintain a separate interface for the result unless another API
    boundary requires it.
 -  Most parsers are required until you wrap them. `optional(p)` yields
    `undefined`; `withDefault(p, value)` yields a fallback value. For Boolean
    flags, use `withDefault(flag("--name"), false)` when absence should mean
    `false`.
 -  Use `message` from *@optique/core/message* for descriptions, help text, and
    custom errors. Prefer semantic message helpers such as `optionName()` and
    `metavar()` over string concatenation when naming CLI elements.
 -  Use value parsers such as `integer()`, `choice()`, `biject()`, `regExp()`,
    `url()`, and `uuid()` instead of validating raw strings after parsing. Use
    `regExp({ flags })` for user-supplied regular expression sources,
    `biject()` for one-to-one string-to-value choices, and `transform()` when
    an existing value parser describes the accepted CLI spelling but your app
    needs a different result type. Use `path()` from
    `@optique/run/valueparser` for file-system paths. Write a custom
    `{ mode, metavar, parse, format }` value parser only when the catalog does
    not cover the domain.
 -  Async value parsers make the containing parser async. If you use packages
    such as *@optique/git*, remember to `await run(...)`, `await parse(...)`, or
    `await runParser(...)` as appropriate.
 -  Use `dependency()` when one value parser controls another's valid values.
    For a multi-level chain, wrap the middle derivation too:
    `dependency(source.deriveSync(...))`. Optique resolves such chains by
    dependency order, independently of object/tuple field order.
 -  Use `derivePromptConfig(source, resolver)` (from *@optique/prompt*,
    re-exported by *@optique/inquirer* and *@optique/clack*) when a prompt's
    choices or message depend on another parsed value. The resolver may be
    async and runs only at the real prompt fallback, after the named sources
    resolve; pass `[sourceA, sourceB]` when it reads several sources. The
    resolver's prompt kind must return the wrapped parser's value type. Derive
    the wrapped parser separately when the CLI domain should change, and make
    it a dependency source only if another consumer needs its answer. Keep
    static prompt configs for everything else.
 -  Pass `{ validate, maxAttempts, signal }` as a generated prompt wrapper's
    third argument, including `prompt()` from *@optique/inquirer* and
    *@optique/clack*. The validator returns `undefined` to accept the prompted
    value or a structured `Message` to retry, synchronously or asynchronously.
    Attempt limits must be positive integers and default to unlimited retries.
    Selection prompts keep their config and use the shared `validate` option.
 -  Implement a custom adapter's `execute(config, context)` so retries can show
    `context.previousValidationMessage`, and forward `context.signal` when the
    prompt library supports aborting active work. Adapter-native validation
    remains separate and completes inside one shared attempt.
 -  Build subcommands with `command()` combined by `or()`. Put a literal field
    such as `command: constant("serve")` in each branch when you want a
    discriminated union.
 -  Enable completion through `run(parser, { completion: "both" })` for CLI
    apps. Do not hand-write completion scripts from parser metadata.
 -  Use `usageLine: [{ type: "ellipsis" }]` in runner options when a large root
    synopsis should become a compact `Usage: myapp ...` line. This applies only
    to root full help; use `command()`'s `usageLine` for subcommand help.
 -  Use `showUsage: false` in runner options when full help should show the
    brief and command or option sections without the `Usage:` synopsis.
    For deeply nested command trees, add `commandList: "top-level"` when root
    help should list only first-level command groups.
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

 -  Do not parse `process.argv` manually before calling Optique. Pass the parser
    to `run()` for applications, or pass explicit argument arrays to `parse()`
    in tests and embedded use.
 -  Do not treat `or(a, b)` as “zero or more alternatives.” It requires one
    matching branch unless the whole `or()` is wrapped in `optional()` or
    `withDefault()`.
 -  Do not use `object()` for mutually exclusive subcommands. Use
    `or(command(...), command(...))`.
 -  Do not forget that `flag("--x")` is required. Wrap it in `optional()` or
    `withDefault(..., false)` for ordinary optional flags.
 -  Do not expect `multiple(p)` to fail when absent; it returns `[]`. Wrap with
    `nonEmpty()` when at least one value is required.
 -  Do not confuse free-order parsing with `seq()`. Most constructs let child
    parsers compete by priority; use `seq()` only for truly ordered grammars.
 -  Do not concatenate plain strings for errors or descriptions. Use structured
    `message` values.
 -  Do not forget to register source contexts when using `bindEnv()`,
    `bindConfig()`, or `bindDerivedDefault()`.
 -  Do not flatten a multi-level dependency graph into duplicated one-level
    factories. Wrap each derived value that becomes a later source with
    `dependency()` and derive the next parser from it.
 -  Do not probe runtime capabilities eagerly before constructing a prompt
    parser. Put synchronous or asynchronous checks in the prompt config's
    `when` field and provide a typed `otherwise` value. The check then runs
    only if parsing reaches the prompt fallback.

For the detailed maintained guide, use <https://optique.dev/pitfalls.md>.


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
