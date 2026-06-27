Common pitfalls
===============

Optique's combinators compose in ways that are usually intuitive, but a handful
of behaviors trip up almost everyone at least once. Most of the confusion traces
back to a few core ideas:

 -  *Combinators describe a grammar, not a checklist.* `or()`, `object()`, and
    friends decide which tokens to consume based on consumption and priority,
    not on the order you wrote them.
 -  *Parsing happens in two stages.* Structural parsing (which tokens go where)
    runs before value parsing (turning strings into typed values).
 -  *“Optional” is something you add, not a default.* Most parsers are required
    until you wrap them.
 -  *Fallback values come from a resolution chain*, not just the command line.
    Environment variables, config files, and derived defaults all feed into it,
    but only when you wire them up.

This page collects the mistakes and misconceptions that follow from those ideas,
with the correct mental model for each.


`or()` is not “optional alternatives”
-------------------------------------

`or(a, b)` means *exactly one of `a` or `b` must match*, not *zero or more of
them may match*. If you give no arguments at all, parsing fails because no
branch matched.

~~~~ typescript twoslash
import { or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { parse } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const mode = or(
  option("--server", string()),
  option("--client", string()),
);

// With neither option present, this FAILS: at least one branch must match.
const a = parse(mode, []);
//    a.success === false

// Wrap the whole or() to make “no selection” a valid outcome.
const b = parse(optional(mode), []);
//    b.success === true, b.value === undefined
~~~~

Use `optional(or(...))` when absence should produce `undefined`, or
`withDefault(or(...), fallback)` when it should produce a fallback value.

Two related surprises:

 -  *Giving two mutually exclusive flags is a conflict, not “last one wins.”*
    `or(option("--mode-a"), option("--mode-b"))` rejects `--mode-a --mode-b`
    with a conflict error rather than silently keeping the last one.
 -  *A non-consuming branch can act as a fallback.*
    `or(constant("auto"), option("-o", string()))` succeeds on empty input
    (yielding `"auto"`) and still prefers the `-o` branch when it is present.
    This works because `constant()` succeeds without consuming any tokens. Note
    that annotation-backed parsers such as `bindEnv(option(...))` and
    positional `argument(...)` parsers are *not* eligible as such fallback
    branches; give those a default through their own binding instead.

See [construct combinators](./concepts/constructs.md) for the full semantics.


`optional()` versus `withDefault()`
-----------------------------------

Both make a parser non-required, but they differ in a way that matters:

 -  `optional(p)` yields `undefined` when `p` does not match. You can tell
    “the user did not provide this” from “the user provided a value.”
 -  `withDefault(p, value)` yields `value` when `p` does not match. You cannot
    distinguish a supplied value from the default, because both look the same.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { optional, withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import type { InferValue } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const a = object({ cwd: optional(option("--cwd", string())) });
type A = InferValue<typeof a>;     // { readonly cwd: string | undefined }

const b = object({ cwd: withDefault(option("--cwd", string()), ".") });
type B = InferValue<typeof b>;     // { readonly cwd: string }
~~~~

Reach for `optional()` when the absence of a value carries meaning (for example,
“fall back to the current directory only if `--cwd` was not given”). Reach for
`withDefault()` when you only need a usable value. Combining the two
(`withDefault(optional(...), ...)`) is redundant; drop one.

> [!NOTE]
> `withDefault()` resolves eagerly, during parsing. The default is *not*
> guaranteed to win just because the command line omitted the option: if the
> wrapped parser resolves a value during completion (from `constant()`,
> `bindEnv()`, or `bindConfig()`), that value wins over the configured default.
> When a fallback must be computed lazily, depend on another parsed value, or
> run only inside a handler, use
> [*@optique/derived-defaults*](./concepts/derived-defaults.md) or
> `deferredValue()` instead.

See [modifying combinators](./concepts/modifiers.md) for details.


What is required by default
---------------------------

Newcomers often assume options are optional by nature and flags are always
present-or-absent. Neither is true.

 -  `option()` and `argument()` that take a value are *required* by default.
    Parsing fails if they are missing. Wrap them with `optional()` or
    `withDefault()` to make them non-required.
 -  `flag("--x")` is *required*: parsing fails if the flag is absent.
 -  `option("--x")` *without* a value parser is a Boolean that defaults to
    `false` when absent and never fails on its own.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { flag, option } from "@optique/core/primitives";
// ---cut-before---
const parser = object({
  // Absent on the command line: this is `false`, and parsing still succeeds.
  verbose: option("-v", "--verbose"),
  // Absent on the command line: parsing FAILS, because flag() is required.
  force: flag("-f", "--force"),
});
~~~~

This also explains a common Boolean trap. `withDefault(option("--watch"), true)`
can never be set to `false`, because the only way to change a value-less option
is to pass it, which produces `true`. When you need an explicit override in both
directions, use `negatableFlag()`, which pairs a positive and a negative name:

~~~~ typescript twoslash
import { withDefault } from "@optique/core/modifiers";
import { message } from "@optique/core/message";
import { negatableFlag } from "@optique/core/primitives";
declare function detectColorSupport(): boolean;
// ---cut-before---
const color = withDefault(
  negatableFlag({ positive: "--color", negative: "--no-color" }),
  () => detectColorSupport(),
  { message: message`auto` },
);
~~~~

See [primitive parsers](./concepts/primitives.md).


Parsing order is free, not positional
-------------------------------------

`object()` and `tuple()` attempt their members in *priority order* (commands
before options and arguments, and so on), independent of the order you wrote
them. Declaration order affects only how options appear in help text, not how
input is matched. As a result, options may appear in any order on the command
line, which is what most CLIs want.

When the grammar genuinely is sequential, for example a positional argument that
must come *before* a subcommand, use `seq()`:

~~~~ typescript twoslash
import { seq } from "@optique/core/constructs";
import { argument, command, constant } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const parser = seq(
  argument(string({ metavar: "PATH" })),
  command("build", constant("build")),
);
~~~~

> [!WARNING]
> `seq()` does not backtrack. If you place a variadic positional parser (such as
> `multiple(argument(...))`) before a command, it can consume the tokens the
> command needed before the command ever gets a chance to match. Keep the prefix
> fixed, or add a clear boundary between the segments.

A subtler consequence of two-stage parsing: `or()` over positional arguments
cannot choose a branch based on which *value parser* succeeds. Structural
parsing decides which branch consumes the positional before any value parser
runs, so in `or(argument(path()), argument(url()))` the second branch is
unreachable. Combine the value parsers into one `argument()` instead, using
`firstOf()` (which tries each in order, so put the more specific parser first):

~~~~ typescript twoslash
import { argument } from "@optique/core/primitives";
import { firstOf, integer, string } from "@optique/core/valueparser";
// ---cut-before---
// Tries integer() first; falls back to string() for everything else.
const target = argument(firstOf(integer(), string()));
~~~~

`firstOf()` is synchronous-only and order-sensitive: a leading `string()` would
shadow every later branch, because it accepts any input.


`multiple()` never fails on its own
-----------------------------------

`multiple()` defaults to `min: 0`, so when nothing matches it returns an empty
array rather than failing. You do not need to null-check the result.

The flip side surprises people: `withDefault(multiple(p), fallback)` does *not*
fall back on empty input, because `multiple()` already succeeded with `[]`. The
default branch is never taken.

~~~~ typescript twoslash
import { multiple, withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
// No --tag given: succeeds with [], NOT with ["latest"].
const tags = withDefault(multiple(option("--tag", string())), ["latest"]);

// Require at least one occurrence so an empty input is a genuine non-match:
const required = multiple(option("--tag", string()), { min: 1 });
~~~~

If you want “use this default when the user supplied nothing,” set `min: 1` on
the inner `multiple()`, or post-process with
`map(multiple(p), xs => xs.length ? xs : fallback)`.


Synchronous versus asynchronous parsing
---------------------------------------

Asynchrony is contagious. If *any* value parser in a parser tree is asynchronous
(for example `gitBranch()` from [*@optique/git*](./integrations/git.md)), the
whole parser becomes asynchronous, and `run()` and `parse()` return a `Promise`.

 -  Use `runAsync()` and `parseAsync()` with asynchronous parsers.
 -  `runSync()` and `parseSync()` reject asynchronous parsers (a type error, and
    a `TypeError` at runtime); they exist for the cases where you know the
    parser is synchronous and want a non-`Promise` return.
 -  Passing `contexts` to `run()` makes it asynchronous, because `run()` selects
    the async two-pass path: `run(syncParser, { contexts })` returns a `Promise`
    even though the parser itself is synchronous. If the parser and the contexts
    are all synchronous, `runSync()` also accepts `contexts` (it delegates to
    the synchronous two-pass path) and stays synchronous.

~~~~ typescript
// Asynchronous parser, or contexts via run()/runAsync():
const config = await runAsync(parser, { contexts: [envContext] });
~~~~

See [runners and execution](./concepts/runners.md).


Fallback sources: environment, config, and derived defaults
-----------------------------------------------------------

Optique offers several ways for a value to come from somewhere other than the
command line, and they are easy to conflate. They serve different purposes:

| Mechanism                                          | Package                     | What it does                                                        | Field type  |
| -------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- | ----------- |
| [`dependency()`](./concepts/dependencies.md)       | *@optique/core/dependency*  | Makes one option's *set of valid values* depend on another's value  | plain value |
| [Derived defaults](./concepts/derived-defaults.md) | *@optique/derived-defaults* | Computes a *default value* from values already parsed (second pass) | plain value |
| [Config files](./integrations/config.md)           | *@optique/config*           | Supplies a fallback from a configuration file                       | plain value |
| [Environment variables](./integrations/env.md)     | *@optique/env*              | Supplies a fallback from an environment variable                    | plain value |
| `deferredValue()`                                  | *@optique/core/modifiers*   | Defers resolution to the handler (prompt, network, conditional)     | a function  |

The single most common mistake here is forgetting to register the context:

> [!WARNING]
> `bindEnv()`, `bindConfig()`, and `bindDerivedDefault()` do nothing unless
> their context is passed to the runner through the `contexts` option. Omitting
> it causes the parser to fall back to a static default if one exists, or
> otherwise fail as a missing value. The binding itself is silent about the
> omission.

~~~~ typescript
// Without this, bindEnv()/bindConfig()/bindDerivedDefault() are no-ops:
await runAsync(parser, { contexts: [envContext] });
//                       ^^^^^^^^^^^^^^^^^^^^^^^^ required
~~~~

When several sources apply to the same option, the documented resolution chain
is *CLI argument > environment variable > config file > static default*. The
order is determined by how you nest the bindings: an outer wrapper overrides an
inner one. Derived defaults slot in wherever you wrap them in that chain.

Two more points worth knowing:

 -  *Fallback values are re-validated.* A config or environment value still
    passes through the inner parser's constraints. A config `port` of `80` is
    rejected by `option("--port", integer({ min: 1024 }))` exactly as a
    command-line `80` would be.
 -  *For config-only or environment-only values, wrap `fail()`, not
    `constant()`.* `constant()` always succeeds, so `bindConfig()` treats it as
    a value the user supplied and skips the file lookup entirely. `fail()`
    always fails, which is what lets the fallback take over.


Value parser surprises
----------------------

 -  *`integer()` accepts decimal only.* Hexadecimal (`0x10`), binary (`0b10`),
    octal (`0o10`), and scientific notation (`1e3`) are all rejected. For values
    beyond `Number.MAX_SAFE_INTEGER`, use `integer({ type: "bigint" })`.
 -  *Negative numbers and `--`.* A value parser handles `-5` fine when it
    follows its option (`--offset -5`). But a *positional* token that begins
    with `-` looks like an option, so use the `--` separator to mark the end of
    options: `myapp -- -5`.
 -  *Bundled short flags are Boolean-only.* `-abc` expands to `-a -b -c` only
    for value-less flags. An option that takes a value cannot be bundled;
    `-p8080` is not `-p 8080`.
 -  *Boolean options reject `=value`.* `--verbose=true` fails for a value-less
    `option("--verbose")`. The `=value` form is for options that take a value.
 -  *`choice()` matches exactly.* It is case-sensitive and whitespace-sensitive
    by default; pass `{ caseInsensitive: true }` to relax case (string choices
    only). It infers a literal union type automatically, so you do *not* need
    `as const`.

~~~~ typescript twoslash
import { choice, integer } from "@optique/core/valueparser";
// ---cut-before---
const big = integer({ type: "bigint" });
const level = choice(["debug", "info", "warn", "error"]);
//    level accepts "debug" | "info" | "warn" | "error"; no `as const` needed.
~~~~

See [value parsers](./concepts/valueparsers.md).


Type-level limits
-----------------

 -  *Combinator arity is bounded.* `or()`, `merge()`, `concat()`, and
    `longestMatch()` infer precise types up to a fixed number of arguments
    (currently 15 for `or()`). Beyond that the compiler reports an explicit
    error; split the branches into nested groups so each call stays within the
    limit.
 -  *`InferValue<T>` is usually unnecessary.* TypeScript infers the result type
    of a parser automatically. Annotating with `InferValue<typeof parser>`
    everywhere tends to add noise without adding safety; reach for it only when
    you need to name the type explicitly.


`run()` exits the process
-------------------------

The `run()` from [*@optique/run*](./concepts/runners.md) is built for
applications, not libraries. On a parse error, or for `--help` and `--version`,
it prints output and calls `process.exit()`. It does not return a result you
inspect for success.

If you need to handle the result yourself (for tests, or for embedding a parser
in a larger program), use the lower-level `parse()` (or `parseSync()` /
`parseAsync()`) from *@optique/core*, which return a `Result` object you can
inspect for success. The mid-level `runParser()` behaves more like `run()`: it
returns the parsed value directly, invokes `onHelp` / `onError` callbacks, or
throws a `RunParserError` by default, rather than returning a `Result`. During
testing you can also pass an `onExit` callback to `run()` to intercept the exit.


Other sharp edges
-----------------

 -  *Trailing arguments meant for another tool.* `multiple(argument(...))` will
    not capture tokens that look like options (anything starting with `-`). To
    forward arbitrary trailing arguments to a sub-tool, use `passThrough()`. Its
    default format is `"equalsOnly"`, which captures only `--opt=value`; use
    `{ format: "greedy" }` to capture every remaining token.

    ~~~~ typescript twoslash
    import { object } from "@optique/core/constructs";
    import { argument, passThrough } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";
    // ---cut-before---
    const parser = object({
      script: argument(string({ metavar: "SCRIPT" })),
      rest: passThrough({ format: "greedy" }),
    });
    ~~~~

 -  *Descriptions are `Message` objects, not plain strings.* They go in the
    trailing options object, built with the `message` template tag.

    ~~~~ typescript twoslash
    import { message } from "@optique/core/message";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";
    // ---cut-before---
    const host = option("--host", string(), {
      description: message`The server host name.`,
    });
    ~~~~

 -  *`map()` must not mutate its input.* During deferred resolution, object and
    array values can be shared placeholder references, so an in-place mutation
    corrupts later parses. Always return a new value.

 -  *Built-in `--help`, `--version`, and `completion` are intercepted only when
    your parser leaves those tokens unconsumed.* If your own grammar accepts the
    same token (for example a positional that happens to be `help`), your parse
    result wins and the runner does not intercept it.

 -  *Command discovery is a runtime feature.* `runProgram({ dir })` from
    [*@optique/discover*](./concepts/discover.md) imports command modules
    dynamically at startup, so bundlers cannot see them. If you rely on tree
    shaking, static bundling, or single-file executables, pass the command
    modules explicitly instead.
