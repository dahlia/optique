---
description: >-
  An honest comparison of Optique with other JavaScript and TypeScript CLI
  libraries—Commander.js, Yargs, Cliffy, Gunshi, Cleye, cmd-ts, Stricli, oclif,
  and Clipanion—showing when each is the better choice.
---

How Optique compares
====================

The JavaScript and TypeScript ecosystem has many excellent command-line
libraries, and most of them are good choices for a lot of tools. The point of
this section is not to argue that Optique wins every time—it doesn't. It is to
show *concretely* how Optique's combinatorial, type-first approach differs from
the builder, declarative, and class-based styles you may already know, so you
can tell when each fits.

Every per-library page is balanced: it shows where the other library is the
better choice and where Optique is, with working code on both sides. If you are
new to Optique's design philosophy, *[Why Optique?](../why.md)* explains the
combinator model these pages build on.


How to read these pages
-----------------------

Each comparison walks through the same three scenarios—the situations where
Optique's model diverges most visibly from configuration- and builder-based
APIs:

1.  *Mutually exclusive option groups* — expressing “either this whole group of
    options, or that one, but never a mix.”
2.  *Shared option groups across subcommands* — defining a set of options once
    and reusing it across several commands.
3.  *CLI args → env vars → config file → interactive prompt* — resolving a
    value from several sources in priority order.

For each scenario the page shows the other library's idiomatic code, then
Optique's, then a short note on when each is the better tool. Optique snippets
are type-checked; competitor snippets are adapted from each library's
documented API. Each page then closes with a *Beyond the three
scenarios* section weighing other dimensions—dependencies, shell completion,
man-page generation, schema integration, and maturity.


The libraries
-------------

 -  *[Commander.js](./commander.md)* — the most widely used Node.js CLI
    framework; mature, imperative, familiar.
 -  *[Yargs](./yargs.md)* — declarative builder with built-in env and config
    support and a middleware pipeline.
 -  *[Cliffy](./cliffy.md)* — batteries-included framework born on Deno, with
    prompts and global options built in.
 -  *[Gunshi](./gunshi.md)* — modern declarative library with a clean config API
    and a plugin system.
 -  *[Cleye](./cleye.md)* — tiny, strongly-typed flag parser that does one thing
    well.
 -  *[cmd-ts](./cmd-ts.md)* — type-first, composable parser inspired by Rust's
    clap; Optique's closest neighbor.
 -  *[Stricli](./stricli.md)* — Bloomberg's deliberately minimal, no-magic
    framework.
 -  *[oclif](./oclif.md)* — Salesforce's full CLI framework with plugins,
    scaffolding, and command discovery.
 -  *[Clipanion](./clipanion.md)* — the class-based command engine behind Yarn.


At a glance
-----------

The version each comparison targets, the API style, and how result types are
obtained:

| Library        | Version | API style           | Result-type inference       | Runtimes         |
| -------------- | ------- | ------------------- | --------------------------- | ---------------- |
| *Optique*      | 1.2     | Parser combinators  | Automatic, built in         | Node.js/Deno/Bun |
| *Commander.js* | 15      | Fluent builder      | Via `extra-typings` package | Node.js          |
| *Yargs*        | 18      | Declarative builder | Via `@types/yargs`          | Node.js          |
| *Cliffy*       | 1.2     | Fluent builder      | Automatic, built in         | Deno/Node.js/Bun |
| *Gunshi*       | 0.35    | Declarative config  | Automatic, built in         | Node.js/Deno/Bun |
| *Cleye*        | 2.6     | Declarative config  | Automatic, built in         | Node.js          |
| *cmd-ts*       | 0.15    | Composable parsers  | Automatic, built in         | Node.js/Deno/Bun |
| *Stricli*      | 1.2     | Functional          | Automatic, built in         | Node.js/Bun/Deno |
| *oclif*        | 4       | Class framework     | Automatic, built in         | Node.js          |
| *Clipanion*    | 4 (rc)  | Class-based         | Automatic, built in         | Node.js          |

How each handles the three scenarios. “Native” means the library has a dedicated
feature; “manual” means you write the logic yourself; “external” means a
separate prompt library is required:

| Library        | Mutually exclusive groups             | Shared option groups       | Env → config → prompt fallback            |
| -------------- | ------------------------------------- | -------------------------- | ----------------------------------------- |
| *Optique*      | `or()` of groups (typed union)        | `merge()` of parsers       | All three, composable                     |
| *Commander.js* | Pairwise `conflicts()`; groups manual | Helper fn / global options | Env native; config + prompt manual        |
| *Yargs*        | Pairwise `conflicts`; groups manual   | Helper fn / middleware     | Env + config native; prompt external      |
| *Cliffy*       | Pairwise `conflicts`; groups manual   | `globalOption` inheritance | Env native + prompt module; config manual |
| *Gunshi*       | Manual in `run`                       | Spread `args` record       | All manual                                |
| *Cleye*        | Manual after parse                    | Spread / duplicate flags   | All manual                                |
| *cmd-ts*       | Manual / custom `Type`                | Spread `args` record       | Via custom `Type`                         |
| *Stricli*      | Manual in handler                     | Spread flags record        | All manual (context injection)            |
| *oclif*        | `exclusive` / `exactlyOne` (flags)    | `baseFlags` inheritance    | Env native; config + prompt manual        |
| *Clipanion*    | Command overloads / schema            | Base command class         | Env native; config + prompt manual        |

> [!NOTE]
> This table summarizes; the per-library pages show the actual code and the
> trade-offs behind each cell. A “manual” or “external” entry is not a verdict—a
> lean library that stays out of your way is the right call for many tools.


Beyond the three scenarios
--------------------------

The scenarios above are where the parsing *models* diverge most, but a CLI
library is more than its parser. A few other dimensions are worth weighing:

| Library        | Runtime deps | Shell completion                           | Man pages      | Schema integration            |
| -------------- | ------------ | ------------------------------------------ | -------------- | ----------------------------- |
| *Optique*      | 0 (core)     | Built in: Bash/zsh/fish/PowerShell/Nushell | *@optique/man* | Standard Schema + Zod/Valibot |
| *Commander.js* | 0            | None built in                              | No             | No                            |
| *Yargs*        | 6            | Built in: Bash/zsh                         | No             | No                            |
| *Cliffy*       | JSR suite    | Built in: Bash/zsh/fish                    | No             | No                            |
| *Gunshi*       | 0 (core)     | Plugin: Bash/zsh                           | No             | No                            |
| *Cleye*        | 2            | None                                       | No             | No                            |
| *cmd-ts*       | 4            | None                                       | No             | Custom `Type` only            |
| *Stricli*      | 0 (core)     | Add-on: Bash                               | No             | No                            |
| *oclif*        | 18           | Plugin: Bash/zsh/PowerShell                | No             | No                            |
| *Clipanion*    | 1            | None built in                              | No             | Typanion only                 |

A few things stand out:

 -  *Dependencies and footprint.* Optique's core has no runtime dependencies—a
    trait it shares with Commander.js, Gunshi, and Stricli; Cleye and Clipanion
    are nearly there. Yargs, cmd-ts, and especially oclif pull in more.
    Optique's integration packages add dependencies only when you use them
    (*@optique/clack* brings in Clack, *@optique/config* and
    *@optique/standard-schema* bring in the Standard Schema spec), so the base
    stays minimal.
 -  *One definition, many outputs.* This is Optique's strongest structural
    advantage. The same parser drives argument parsing, `--help`, shell
    completion across five shells (with context-aware and async suggestions),
    and Unix man pages via *@optique/man*. Several libraries generate completion
    scripts, but Optique covers the most shells and is the only one here that
    also generates man pages.
 -  *Schema integration.* Optique integrates any Standard Schema-compatible
    validator as a value parser via *@optique/standard-schema*, keeps richer
    Zod and Valibot adapters for schema-specific CLI behavior, and validates
    config files with any Standard Schema validator via *@optique/config*.
    None of the others integrate Standard Schema; cmd-ts and Clipanion ship
    their own validation abstractions, and the rest leave value validation to
    you.
 -  *Maturity and ecosystem.* This is where the established libraries lead, and
    it matters. Commander.js and Yargs are ubiquitous, with enormous adoption
    and a deep well of examples; oclif is enterprise-proven behind the
    Salesforce, Heroku, and Shopify CLIs; Clipanion powers Yarn. Optique is
    young by comparison, so betting on a long-lived, widely-known dependency
    favors the incumbents.
 -  *Learning curve.* Optique's combinator model asks you to think in composable
    parsers, which is less immediately familiar than the builder and declarative
    APIs most of these libraries offer. That investment is what buys the type
    inference and composition; whether it pays off depends on how much your CLI
    will grow.

The comparisons reflect the versions listed above, current as of June 2026.
Third-party libraries evolve, so check their latest documentation if a detail
matters to your decision.
