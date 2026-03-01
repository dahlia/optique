<!-- markdownlint-disable MD013 -->

Optique changelog
=================

Version 1.0.0
-------------

To be released.

### @optique/core

 -  Added `options` parameter to `SourceContext.getAnnotations()`.  Contexts
    now receive runtime options (e.g., `getConfigPath`, `load`) passed by
    the runner, enabling config contexts to load files without a separate
    `runWithConfig()` wrapper.  [[#110]]

 -  Renamed `SourceContext._requiredOptions` to `$requiredOptions` to follow
    the `$` prefix convention used by `ValueParser.$mode`, `Parser.$mode`,
    etc.  [[#110]]

 -  Added optional `Symbol.dispose` and `Symbol.asyncDispose` methods to
    `SourceContext`.  Contexts that hold resources (e.g., global registries)
    can now implement `Disposable` / `AsyncDisposable` for automatic cleanup.
    `runWith()` and `runWithSync()` call dispose on all contexts in a
    `finally` block.  [[#110]]

 -  Added `fail<T>()` parser: always fails without consuming input, declared
    to produce a value of type `T`.  Its primary use is as the inner parser
    for `bindConfig(fail<T>(), { … })` when a value should come only from a
    config file and has no corresponding CLI flag.  [[#120]]

 -  Changed `formatMessage()` to render double newlines (`\n\n`) in `text()`
    terms as double newlines in the output, instead of collapsing them to
    a single newline.  This makes paragraph breaks visually distinct from
    explicit `lineBreak()` terms, which render as a single newline.

 -  Changed the default section ordering in help output to use a smart
    type-aware sort: sections containing only commands appear first, followed
    by mixed sections, and then sections containing only options, flags, and
    arguments.  Untitled sections receive a slight priority boost so the
    main (untitled) section appears before titled sections of a similar
    classification.  Within each group, the original relative order is
    preserved.  Previously, untitled sections were sorted first regardless
    of content type.  This is a breaking change for help output layout.
    [[#115]]

 -  Added `sectionOrder` option to `DocPageFormatOptions` (in
    `formatDocPage()`), `RunOptions` (in `runParser()`), and `RunOptions`
    (in *@optique/run*'s `run()`).  When provided, the callback overrides
    the default smart sort to give full control over section ordering in
    help output.  [[#115]]

 -  Fixed `optional()` and `withDefault()` crashing when the parser's state
    is an annotation-injected object instead of `undefined`.  The state
    discrimination in `modifiers.ts` now uses `Array.isArray(state)` to
    distinguish the wrapped inner state `[TState]` from the initial state,
    instead of `typeof state === "undefined"`.  This allows annotation
    injection to work correctly for parsers with `undefined` initial states
    (e.g., `fail()` used with `bindConfig()`), which was broken by the
    earlier 0.10.6 fix that skipped injection entirely.  [[#131]]

 -  Extended `hidden` visibility controls from `boolean` to
    `boolean | "usage" | "doc"` across primitive parsers:
    `option()`, `flag()`, `argument()`, `command()`, and `passThrough()`.
    `group()`, `object()`, and `merge()` now also support `hidden` with the
    same values, and wrapper/parser `hidden` values are combined as a union.
    `hidden: true` keeps the existing behavior (hidden from usage, docs,
    and suggestions), while `"usage"` and `"doc"` allow partial hiding.
    [[#113]]

 -  Redesigned meta command configuration (help, version, completion) in
    `RunOptions` to use independent `command`/`option` sub-configs instead
    of `mode: "command" | "option" | "both"`.  Each meta command now accepts
    `{ command?: true | CommandSubConfig; option?: true | OptionSubConfig }`
    where at least one must be specified (enforced at the type level).
    `CommandSubConfig` supports `names` (first = display name, rest = hidden
    aliases via `longestMatch()`), `group`, and `hidden`.  `OptionSubConfig`
    supports `names` (all shown in help), `group`, and `hidden`.  This is
    a breaking change.  [[#130]]

 -  Removed `CompletionName`, `CompletionHelpVisibility`, `CompletionConfig`,
    `CompletionConfigBoth`, `CompletionConfigSingular`, and
    `CompletionConfigPlural` types.  Completion naming is now controlled via
    `CommandSubConfig.names` and `OptionSubConfig.names`.  [[#130]]

 -  Added support for equals-joined values on single-dash multi-character
    options in `option()` (e.g., `-seed=42`, `-max_len=1000`), in addition to
    existing `--option=value` and `/option:value` formats.  Single-character
    short options (e.g., `-v`) remain excluded from this joined form to avoid
    conflicts with short-option clustering.  `flag()` now also rejects this
    joined form consistently for Boolean flags.  [[#134] by Maxwell Koo]

 -  Added `SourceContextMode` type (`"static" | "dynamic"`) and optional
    `mode` field to `SourceContext`.  When set, `isStaticContext()` reads this
    field directly instead of calling `getAnnotations()`, preventing any side
    effects that `getAnnotations()` might have (such as mutating a global
    registry).  `createEnvContext()` sets `mode: "static"`;
    `createConfigContext()` sets `mode: "dynamic"`.  Existing custom contexts
    that omit the field are unaffected.

[#110]: https://github.com/dahlia/optique/issues/110
[#113]: https://github.com/dahlia/optique/issues/113
[#115]: https://github.com/dahlia/optique/issues/115
[#120]: https://github.com/dahlia/optique/issues/120
[#130]: https://github.com/dahlia/optique/issues/130
[#131]: https://github.com/dahlia/optique/issues/131
[#134]: https://github.com/dahlia/optique/pull/134

### @optique/config

 -  Removed `configKey` symbol.  Each `ConfigContext` instance now stores
    its data under its own unique `id` symbol (i.e., `context.id`) so that
    multiple config contexts can coexist without overwriting each other in
    merged annotations.  This is a breaking change for any code that accessed
    annotations directly via `configKey`.  [[#136]]

 -  Removed `runWithConfig()` and the `@optique/config/run` subpath export.
    Config contexts are now used directly with `run()`, `runSync()`, or
    `runAsync()` from *@optique/run* (or `runWith()` from
    `@optique/core/facade`) via the `contexts` option.  Context-specific
    options like `getConfigPath` and `load` are passed alongside the standard
    runner options.  This is a breaking change.  [[#110]]

 -  Moved `fileParser` option from `runWithConfig()` runtime options into
    `createConfigContext()` options.  The file parser is now stored in the
    context at creation time.  [[#110]]

 -  Changed `ConfigContextRequiredOptions` to make both `getConfigPath` and
    `load` optional fields (with runtime validation that at least one is
    provided).  [[#110]]

 -  Added `ConfigContext` implementation of `Symbol.dispose` for automatic
    cleanup of the global config registry.  [[#110]]

 -  Fixed `bindConfig()` composition with `bindEnv()`: when no CLI token is
    consumed, `bindConfig()` no longer incorrectly marks the result as
    “CLI-provided”, which was causing `bindEnv(bindConfig(…))` to skip the
    environment-variable fallback even when the CLI option was absent.

 -  Added config-source metadata support for `bindConfig()` key accessors.
    Accessor callbacks now receive a second `meta` argument, and single-file
    mode now provides default `ConfigMeta` values (`configPath`, `configDir`)
    so path-like options can be resolved relative to the config file location.
    [[#111]]

 -  Changed `CustomLoadOptions.load` to return
    `{ config, meta }` (`ConfigLoadResult<TConfigMeta>`) instead of raw config
    data.  This makes metadata extensible for custom multi-file loaders and
    allows `createConfigContext<T, TConfigMeta>()` to carry a custom metadata
    type through to `bindConfig()` key callbacks.  [[#111]]

[#111]: https://github.com/dahlia/optique/issues/111
[#136]: https://github.com/dahlia/optique/issues/136

### @optique/env

The *@optique/env* package was introduced in this release, providing
environment variable integration via source contexts.  [[#86], [#135]]

 -  Added `createEnvContext()` for creating static environment contexts with
    optional key prefixes and custom source functions.

 -  Added `bindEnv()` for parser fallback behavior with priority order
    CLI > environment > default.

 -  Added `bool()` value parser for common environment Boolean literals
    (`true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`).

 -  Added support for env-only values via `bindEnv(fail<T>(), ...)` when a
    value should not be exposed as a CLI option.

[#86]: https://github.com/dahlia/optique/issues/86
[#135]: https://github.com/dahlia/optique/pull/135

### @optique/run

 -  Added `stdout`, `stderr`, and `onExit` options to `run()`, `runSync()`,
    and `runAsync()` for dependency injection of process-integrated behavior.
    This allows embedding and test environments to capture output and control
    exit handling without monkey-patching `process.stdout`/`process.stderr`
    or `process.exit`.  By default, behavior is unchanged
    (`process.stdout.write`, `process.stderr.write`, and `process.exit`).
    [[#112]]

 -  Redesigned `RunOptions.help`, `RunOptions.version`, and
    `RunOptions.completion` to use the new `command`/`option` sub-config
    structure from *@optique/core*.  String shorthands (`"command"`,
    `"option"`, `"both"`) and the version string shorthand are preserved
    for convenience.  Object configurations now use `{ command, option }`
    instead of `{ mode }`.  [[#130]]

 -  Removed `CompletionHelpVisibility`, `CompletionOptionsBase`,
    `CompletionOptionsBoth`, `CompletionOptionsSingular`,
    `CompletionOptionsPlural`, and `CompletionOptions` types.  [[#130]]

[#112]: https://github.com/dahlia/optique/issues/112


Version 0.10.6
--------------

Released on February 20, 2026.

### @optique/core

 -  Fixed `runWith()` (and by extension `runWithConfig()`) crashing with
    `TypeError: Cannot read properties of undefined` when the top-level parser
    has an `undefined` initial state, such as `withDefault(object({...}))`.
    The root cause was that `injectAnnotationsIntoParser()` unconditionally
    spread `parser.initialState` into a new object with the annotation key,
    turning `undefined` into `{ [annotationKey]: annotations }`.  This corrupted
    the state for parsers like `withDefault()` and `optional()` that rely on
    `typeof state === "undefined"` to distinguish the uninitialized state from
    a wrapped inner state.  The fix skips annotation injection when the initial
    state is `null` or `undefined`.  The same guard was applied to annotation
    injection in `parseSync()`, `parseAsync()`, `suggestSync()`,
    `suggestAsync()`, and `getDocPage()`.  [[#131]]

 -  Fixed `formatDocPage()` to respect `maxWidth` when the rendered option
    term is wider than `termWidth` (default: 26).  Previously, the description
    column width was calculated assuming the term occupied exactly `termWidth`
    characters.  When the actual term was wider (e.g.,
    `-p, --package-manager PACKAGE_MANAGER` at 38 chars), the description
    column started further right on the first output line, but `formatMessage()`
    was still given the full `descColumnWidth` budget, allowing lines to exceed
    `maxWidth` by as much as the term's extra width.  The fix passes the extra
    width as `startWidth` to `formatMessage()` so the first-line budget is
    correctly narrowed.  The same correction is applied when appending default
    values (`showDefault`) and available choices (`showChoices`).  [[#132]]

 -  Fixed `formatDocPage()` to account for the closing suffix (`]` for default
    values, `)` for choices) when word-wrapping content.  Previously, the suffix
    was appended after `formatMessage()` had already filled the description
    column to capacity, producing lines that were one character too wide.

[#132]: https://github.com/dahlia/optique/issues/132


Version 0.10.5
--------------

Released on February 20, 2026.

### @optique/core

 -  Fixed meta options (`--help`, `--version`, `--completion`) being absent
    from both the usage line and the options list in the full help page, even
    though they appear correctly in the usage line shown above parse errors.
    The root cause was that `helpGeneratorParser`—the parser used to produce
    the help page—was built from the user's parser and any meta *commands*,
    but never included the meta *option* parsers (`helpOption`, `versionOption`,
    `completionOption`).  As a result, `getDocFragments()` was never called on
    those parsers, so their entries were silently omitted.  The fix adds the
    meta option parsers to the `commandParsers` list whenever the corresponding
    mode is `"option"` or `"both"`.  [[#127]]

 -  Fixed `formatDocPage()` to respect `maxWidth` when appending default values
    and available choices via `showDefault` and `showChoices`.  Previously,
    the appended text was concatenated onto the description string after
    word-wrapping had already been applied, with no awareness of how much of
    the current line was already occupied, so lines could far exceed `maxWidth`.
    [[#129]]

[#127]: https://github.com/dahlia/optique/issues/127
[#129]: https://github.com/dahlia/optique/issues/129


Version 0.10.4
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed `formatMessage()` to correctly handle a `lineBreak()` term that is
    immediately followed by a newline character in the source template literal.
    Previously, the newline after `${lineBreak()}` was normalized to a space
    (as single `\n` characters in text terms are), producing a spurious leading
    space at the start of the next line.  The newline immediately following a
    `lineBreak()` term is now dropped instead of being converted to a space.

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]

[#121]: https://github.com/dahlia/optique/issues/121


Version 0.10.3
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?` even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]

[#116]: https://github.com/dahlia/optique/issues/116
[#117]: https://github.com/dahlia/optique/issues/117
[#118]: https://github.com/dahlia/optique/issues/118
[#119]: https://github.com/dahlia/optique/issues/119


Version 0.10.2
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.

[#114]: https://github.com/dahlia/optique/issues/114

### @optique/config

 -  Fixed `runWithConfig()` showing a raw `SyntaxError` stack trace when
    a config file contains malformed JSON.  It now prints a friendly error
    message that includes the file path.
    [[#109]]

[#109]: https://github.com/dahlia/optique/issues/109


Version 0.10.1
--------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.

### @optique/config

 -  Fixed `bindConfig()` usage rendering when `default` is provided. The
    generated usage term is now wrapped as optional, so usage strings correctly
    show the bound option in square brackets (`[]`).


Version 0.10.0
--------------

Released on February 15, 2026.

### @optique/core

 -  Added annotations system for passing runtime context to parsers. This allows
    parsers to access external runtime data during both `parse()` and
    `complete()` phases, enabling use cases like config file fallbacks,
    environment-based validation, and shared context. [[#83]]

    The annotations system uses symbol-keyed records to avoid naming conflicts
    between packages. Annotations are passed via the new `ParseOptions`
    parameter and can be accessed using the `getAnnotations()` helper function.

    New exports from `@optique/core/annotations`:

     -  `annotationKey`: Symbol for storing annotations in parser state.
     -  `Annotations`: Type for annotation records (symbol-keyed objects).
     -  `ParseOptions`: Options interface for parse functions.
     -  `getAnnotations()`: Helper function to extract annotations from state.

    Updated function signatures (all now accept optional `ParseOptions`):

     -  `parse()`, `parseSync()`, `parseAsync()`
     -  `suggest()`, `suggestSync()`, `suggestAsync()`
     -  `getDocPage()`, `getDocPageSync()`, `getDocPageAsync()`


    ~~~~ typescript
    import { parse, getAnnotations } from "@optique/core/parser";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";

    // Define annotation key for your package
    const configDataKey = Symbol.for("@myapp/config");

    // Two-pass parsing with config file
    const firstPass = parse(parser, args);
    const configData = await loadConfig(firstPass.value.configPath);

    const finalResult = parse(parser, args, {
      annotations: {
        [configDataKey]: configData,
      },
    });

    // Access annotations in custom parser
    function myCustomParser() {
      return {
        // ... parser implementation
        complete: (state) => {
          const annotations = getAnnotations(state);
          const config = annotations?.[configDataKey];
          // Use config data for fallback values
        },
      };
    }
    ~~~~

    This is a backward-compatible change. Existing code continues to work
    unchanged as the `options` parameter is optional and annotations are only
    used when explicitly provided.

    See the [runtime context extension guide] for detailed documentation and
    usage patterns.

 -  Added `SourceContext` system and `runWith()` functions for composing
    multiple data sources with automatic priority handling. This builds on the
    annotations system to provide a higher-level abstraction for common
    use cases like environment variable fallbacks and config file loading.
    [[#85]]

    The source context system enables packages to provide data sources in a
    standard way with clear priority ordering. Earlier contexts in the array
    override later ones, making it natural to implement fallback chains like
    CLI > environment variables > configuration file > default values.

    New exports from `@optique/core/context`:

     -  `SourceContext`: Interface for data sources that provide annotations.
     -  `Annotations`: Re-exported from `@optique/core/annotations`.
     -  `isStaticContext()`: Helper to check if a context is static.

    New exports from `@optique/core/facade`:

     -  `runWith()`: Run parser with multiple source contexts (async).
     -  `runWithSync()`: Sync-only variant of `runWith()`.
     -  `runWithAsync()`: Explicit async variant of `runWith()`.

    The `runWith()` function uses a smart two-phase approach:

    1)  Collect annotations from all contexts (static return immediately,
        dynamic may return empty)
    2)  First parse with Phase 1 annotations
    3)  Call `getAnnotations(parsed)` on all contexts with parsed result
    4)  Second parse with merged annotations from both phases

    If all contexts are static, the second parse is skipped for optimization.

    The `runWith()` function ensures that help, version, and completion
    features always work, even when config files are missing or contexts
    would fail to load. Users can always access `--help`, `--version`, and
    completion without requiring a valid environment setup. [[#92]]

    ~~~~ typescript
    import { runWith } from "@optique/core/facade";
    import type { SourceContext } from "@optique/core/context";

    const envContext: SourceContext = {
      id: Symbol.for("@myapp/env"),
      getAnnotations() {
        return {
          [Symbol.for("@myapp/env")]: {
            HOST: process.env.MYAPP_HOST,
          }
        };
      }
    };

    const result = await runWith(
      parser,
      "myapp",
      [envContext],
      { args: process.argv.slice(2) }
    );
    ~~~~

 -  Added `url()` message component for displaying URLs with clickable
    hyperlinks in terminals that support OSC 8 escape sequences. URLs are
    validated using `URL.canParse()` and stored as `URL` objects internally.
    When colors are enabled, URLs are rendered with OSC 8 hyperlink sequences
    making them clickable in compatible terminals. When quotes are enabled,
    URLs are wrapped in angle brackets (`<>`).

    ~~~~ typescript
    import { message, url } from "@optique/core/message";

    const helpMsg = message`Visit ${url("https://example.com")} for details.`;
    ~~~~

    New exports:

     -  `url()`: Creates a URL message term from a string or URL object.
     -  `link()`: Alias for `url()`, useful for avoiding naming conflicts with
        the `url()` value parser from `@optique/core/valueparser`.

 -  Added `lineBreak()` message component for explicit single-line breaks in
    structured messages. Unlike single `\n` in `text()` terms (which are
    treated as soft breaks and rendered as spaces), `lineBreak()` always
    renders as a hard line break.

    ~~~~ typescript
    import { commandLine, lineBreak, message } from "@optique/core/message";

    const examples = message`Examples:${lineBreak()}
      Bash: ${commandLine(`eval "$(mycli completion bash)"`)}${lineBreak()}
      zsh:  ${commandLine(`eval "$(mycli completion zsh)"`)}`;
    ~~~~

 -  Added `@optique/core/program` module with `Program` and `ProgramMetadata`
    interfaces. These provide a structured way to bundle a parser with its
    metadata (name, version, description, etc.), creating a single source of
    truth for CLI application information. [[#82]]

    New exports:

     -  `Program<M, T>`: Interface bundling a parser with metadata.
     -  `ProgramMetadata`: Interface for program metadata including name,
        version, brief, description, author, bugs, examples, and footer.
     -  `defineProgram()`: Helper function for automatic type inference when
        creating `Program` objects. This eliminates the need to manually specify
        `Program<"sync", InferValue<typeof parser>>` type annotations.

 -  Added support for displaying `author`, `bugs`, and `examples` metadata
    fields in help text. When these fields are provided in `ProgramMetadata`
    or `RunOptions`, they are now displayed in the help output in the following
    order: Examples → Author → Bugs (before the footer). Each section has
    a bold label (when colors are enabled) and indented content for clear
    visual separation.

    ~~~~ typescript
    import { defineProgram } from "@optique/core/program";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";
    import { message } from "@optique/core/message";

    const prog = defineProgram({
      parser: option("--name", string()),
      metadata: {
        name: "myapp",
        version: "1.0.0",
        brief: message`A sample CLI application`,
        description: message`This tool processes data efficiently.`,
        author: message`Jane Doe <jane@example.com>`,
      },
    });
    ~~~~

 -  Updated `runParser()` to accept `Program` objects directly. The new API
    automatically extracts program name and metadata from the `Program` object,
    eliminating the need to pass these separately. Both the new `Program`-based
    API and the original `parser`-based API are supported. [[#82]]

    ~~~~ typescript
    import { runParser } from "@optique/core/facade";

    // Program-based API (recommended for applications with metadata)
    const result = runParser(prog, ["--name", "Alice"]);

    // Parser-based API (useful for simple scripts)
    const result = runParser(parser, "myapp", ["--name", "Alice"], {
      brief: message`A sample CLI application`,
      // ...
    });
    ~~~~

 -  Added inter-option dependency support via `@optique/core/dependency` module.
    This allows one option's valid values to depend on another option's parsed
    value, enabling dynamic validation and context-aware shell completion.
    [[#74], [#76]]

    New exports:

     -  `dependency()`: Creates a dependency source from an existing value parser.
     -  `deriveFrom()`: Creates a derived parser from multiple dependency sources.
     -  `DependencySource<M, T>`: A value parser that can be referenced by other
        parsers.
     -  `DerivedValueParser<M, T>`: A value parser whose behavior depends on
        other parsers' values.

    The dependency system uses deferred parsing: dependent options store their
    raw input during initial parsing, then re-validate using actual dependency
    values after all options are collected.

    ~~~~ typescript
    import { dependency } from "@optique/core/dependency";
    import { choice } from "@optique/core/valueparser";

    // Create a dependency source
    const modeParser = dependency(choice(["dev", "prod"] as const));

    // Create a derived parser that depends on the mode
    const logLevelParser = modeParser.derive({
      metavar: "LEVEL",
      factory: (mode) => {
        if (mode === "dev") {
          return choice(["debug", "info", "warn", "error"]);
        } else {
          return choice(["warn", "error"]);
        }
      },
      defaultValue: () => "dev" as const,
    });
    ~~~~

    Dependencies work seamlessly with all parser combinators (`object()`,
    `subcommands()`, `or()`, `longestMatch()`, `multiple()`, etc.) and support
    both sync and async parsers.

 -  Added `nonEmpty()` modifier that requires the wrapped parser to consume at
    least one input token to succeed.  This enables conditional default values
    and help display logic when using `longestMatch()`.  [[#79], [#80]]

    ~~~~ typescript
    import { longestMatch, object } from "@optique/core/constructs";
    import { nonEmpty, optional, withDefault } from "@optique/core/modifiers";
    import { constant, option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";

    // Without nonEmpty(): activeParser always wins (consumes 0 tokens)
    // With nonEmpty(): helpParser wins when no options are provided
    const activeParser = nonEmpty(object({
      mode: constant("active" as const),
      cwd: withDefault(option("--cwd", string()), "./default"),
      key: optional(option("--key", string())),
    }));

    const helpParser = object({ mode: constant("help" as const) });
    const parser = longestMatch(activeParser, helpParser);
    ~~~~

 -  Added `port()` value parser for TCP/UDP port numbers with support for both
    `number` and `bigint` types, range validation, and well-known port
    restrictions. The parser validates port numbers (1–65535 by default) and
    optionally enforces custom ranges or disallows well-known ports (1–1023).
    [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { port } from "@optique/core/valueparser";

    // Basic port parser (1-65535)
    option("--port", port())

    // Non-privileged ports only
    option("--port", port({ min: 1024, max: 65535 }))

    // Disallow well-known ports
    option("--port", port({ disallowWellKnown: true }))

    // Using bigint type
    option("--port", port({ type: "bigint" }))
    ~~~~

 -  Added `ipv4()` value parser for IPv4 address validation with filtering
    options for private, loopback, link-local, multicast, broadcast, and zero
    addresses. The parser validates IPv4 addresses in dotted-decimal notation
    (e.g., “192.168.1.1”) and provides fine-grained control over which address
    types are accepted. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { ipv4 } from "@optique/core/valueparser";

    // Basic IPv4 parser (allows all types)
    option("--ip", ipv4())

    // Public IPs only (no private/loopback)
    option("--public-ip", ipv4({
      allowPrivate: false,
      allowLoopback: false
    }))

    // Server binding address
    option("--bind", ipv4({
      allowZero: true,
      allowPrivate: true
    }))
    ~~~~

 -  Added `hostname()` value parser for DNS hostname validation with support
    for wildcards, underscores, localhost filtering, and length constraints.
    The parser validates hostnames according to RFC 1123 with configurable
    options for special cases like service discovery records and SSL certificate
    domains. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { hostname } from "@optique/core/valueparser";

    // Basic hostname parser
    option("--host", hostname())

    // Allow wildcards for SSL certificates
    option("--domain", hostname({ allowWildcard: true }))

    // Reject localhost for remote connections
    option("--remote", hostname({ allowLocalhost: false }))

    // Service discovery records (allow underscores)
    option("--srv", hostname({ allowUnderscore: true }))
    ~~~~

 -  Added `email()` value parser for email address validation with support for
    display names, multiple addresses, domain filtering, and quoted local parts.
    The parser validates email addresses according to simplified RFC 5322
    addr-spec format with practical defaults for common use cases. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { email } from "@optique/core/valueparser";

    // Basic email parser
    option("--email", email())

    // Multiple email addresses
    option("--to", email({ allowMultiple: true }))

    // Allow display names
    option("--from", email({ allowDisplayName: true }))

    // Restrict to company domains
    option("--work-email", email({ allowedDomains: ["company.com"] }))

    // Convert to lowercase
    option("--email", email({ lowercase: true }))
    ~~~~

 -  Added `socketAddress()` value parser for socket addresses in “host:port”
    format. The parser validates both hostname and IPv4 addresses combined with
    port numbers, with support for default ports, custom separators, and host
    type filtering. Returns a `SocketAddressValue` object containing both host
    and port. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { socketAddress } from "@optique/core/valueparser";

    // Basic socket address (requires port)
    option("--endpoint", socketAddress({ requirePort: true }))

    // With default port
    option("--server", socketAddress({ defaultPort: 80 }))

    // IP addresses only
    option("--bind", socketAddress({
      defaultPort: 8080,
      host: { type: "ip" }
    }))

    // Non-privileged ports only
    option("--listen", socketAddress({
      defaultPort: 8080,
      port: { min: 1024 }
    }))
    ~~~~

 -  Added `portRange()` value parser for port ranges (e.g., “8000-8080”). The
    parser validates port ranges with support for both `number` and `bigint`
    types, custom separators, single port mode, and min/max constraints.
    Returns a `PortRangeValue` object containing `start` and `end` ports.
    [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { portRange } from "@optique/core/valueparser";

    // Basic port range
    option("--ports", portRange())

    // Allow single port (returns range with start === end)
    option("--ports", portRange({ allowSingle: true }))

    // Custom separator
    option("--ports", portRange({ separator: ":" }))

    // Non-privileged ports only
    option("--ports", portRange({ min: 1024 }))

    // Using bigint type
    option("--ports", portRange({ type: "bigint" }))
    ~~~~

 -  Added `macAddress()` value parser for MAC (Media Access Control)
    addresses. The parser validates MAC-48 addresses in multiple formats
    (colon-separated, hyphen-separated, Cisco dot notation, or no separator)
    with support for case conversion and output normalization. Returns a
    formatted string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { macAddress } from "@optique/core/valueparser";

    // Accept any format
    option("--mac", macAddress())

    // Normalize to uppercase colon-separated
    option("--mac", macAddress({
      outputSeparator: ":",
      case: "upper"
    }))

    // Cisco format only
    option("--mac", macAddress({
      separator: ".",
      case: "lower"
    }))
    ~~~~

 -  Added `domain()` value parser for domain name validation. The parser
    validates domain names according to RFC 1035 with configurable options for
    subdomain filtering, TLD restrictions, minimum label requirements, and case
    normalization. Returns a formatted string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { domain } from "@optique/core/valueparser";

    // Accept any valid domain
    option("--domain", domain())

    // Root domains only (no subdomains)
    option("--root", domain({ allowSubdomains: false }))

    // Restrict to specific TLDs
    option("--domain", domain({ allowedTLDs: ["com", "org", "net"] }))

    // Normalize to lowercase
    option("--domain", domain({ lowercase: true }))
    ~~~~

 -  Added `ipv6()` value parser for IPv6 address validation. The parser
    validates and normalizes IPv6 addresses to canonical form (lowercase,
    compressed using `::` notation) with support for full addresses, compressed
    notation, and IPv4-mapped IPv6 addresses. Configurable address type
    restrictions for loopback, link-local, unique local, multicast, and zero
    addresses. Returns a normalized string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { ipv6 } from "@optique/core/valueparser";

    // Accept any IPv6 address
    option("--ipv6", ipv6())

    // Global unicast only (no link-local, no unique local)
    option("--public-ipv6", ipv6({
      allowLinkLocal: false,
      allowUniqueLocal: false
    }))

    // No loopback addresses
    option("--ipv6", ipv6({ allowLoopback: false }))
    ~~~~

 -  Added `ip()` value parser that accepts both IPv4 and IPv6 addresses. The
    parser can be configured to accept only IPv4, only IPv6, or both (default).
    Delegates to `ipv4()` and `ipv6()` parsers based on version setting, with
    intelligent error handling that preserves specific validation errors.
    Returns a normalized IP address string. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { ip } from "@optique/core/valueparser";

    // Accept both IPv4 and IPv6
    option("--ip", ip())

    // IPv4 only
    option("--ipv4", ip({ version: 4 }))

    // Public IPs only (both versions)
    option("--public-ip", ip({
      ipv4: { allowPrivate: false, allowLoopback: false },
      ipv6: { allowLinkLocal: false, allowUniqueLocal: false }
    }))
    ~~~~

 -  Added `cidr()` value parser for CIDR notation validation. The parser
    validates CIDR notation like `192.168.0.0/24` or `2001:db8::/32` and
    returns a structured object with the normalized IP address, prefix length,
    and IP version. Supports prefix length constraints and delegates IP
    validation to `ipv4()` and `ipv6()` parsers. [[#89]]

    ~~~~ typescript
    import { option } from "@optique/core/primitives";
    import { cidr } from "@optique/core/valueparser";

    // Accept both IPv4 and IPv6 CIDR
    option("--network", cidr())

    // IPv4 CIDR only with prefix constraints
    option("--subnet", cidr({
      version: 4,
      minPrefix: 16,
      maxPrefix: 24
    }))
    ~~~~

 -  Removed deprecated `run` export. Use `runParser()` instead. The old name
    was deprecated in v0.9.0 due to naming conflicts with `@optique/run`'s
    `run()` function. [[#65]]

 -  Removed deprecated `RunError` export. Use `RunParserError` instead.
    This was renamed in v0.9.0 for consistency with the `runParser()` rename.
    [[#65]]

 -  Added `helpVisibility` to completion configuration in `runParser()` and
    `runWith*()` APIs. This allows keeping both singular and plural completion
    aliases enabled at runtime while controlling whether help shows singular,
    plural, both, or none of the completion entries. Type definitions now
    enforce valid `name` and `helpVisibility` combinations at compile time.
    [[#99]]

 -  Added `showChoices` option to `formatDocPage()` and `runParser()` for
    displaying valid choices in help output.  When enabled, options and
    arguments backed by `choice()` value parsers automatically show their
    valid values in help text, similar to the existing `showDefault` feature.
    [[#106]]

    ~~~~ typescript
    import { runParser } from "@optique/core/facade";

    // Basic usage — shows "(choices: json, yaml, xml)"
    runParser(parser, "myapp", args, { showChoices: true });

    // Custom format — shows "{json | yaml | xml}"
    runParser(parser, "myapp", args, {
      showChoices: { prefix: " {", suffix: "}", label: "" },
    });
    ~~~~

    New APIs:

     -  `ValueParser.choices`: Optional array of valid choices, populated
        automatically by the `choice()` function.
     -  `DocEntry.choices`: Formatted choices as a `Message` for help rendering.
     -  `ShowChoicesOptions`: Interface for customizing choices display
        (prefix, suffix, label, maxItems).
     -  `DocPageFormatOptions.showChoices`: Enables choices display in
        formatted help output.
     -  `RunOptions.showChoices`: Passes through to `formatDocPage()`.

 -  Added `group` option for meta-commands (help, version, completion) in
    `RunOptions`.  When specified, the meta-command appears under a titled
    section in help output instead of alongside user-defined commands.
    Commands sharing the same group name are merged into a single section.
    [[#107]]

    The `group` option is only available when the meta-command has a command
    mode (`"command"` or `"both"`).  When the mode is `"option"`, the `group`
    option is blocked at the type level (`group?: never`).

    ~~~~ typescript
    import { runParser } from "@optique/core/facade";

    runParser(parser, "myapp", args, {
      help: { mode: "both", group: "Other" },
      version: { mode: "both", value: "1.0.0", group: "Other" },
      completion: { mode: "both", group: "Other" },
    });
    ~~~~

[runtime context extension guide]: https://optique.dev/concepts/extend
[#65]: https://github.com/dahlia/optique/issues/65
[#74]: https://github.com/dahlia/optique/issues/74
[#76]: https://github.com/dahlia/optique/pull/76
[#79]: https://github.com/dahlia/optique/issues/79
[#80]: https://github.com/dahlia/optique/pull/80
[#82]: https://github.com/dahlia/optique/issues/82
[#83]: https://github.com/dahlia/optique/issues/83
[#85]: https://github.com/dahlia/optique/issues/85
[#89]: https://github.com/dahlia/optique/issues/89
[#92]: https://github.com/dahlia/optique/issues/92
[#99]: https://github.com/dahlia/optique/issues/99
[#106]: https://github.com/dahlia/optique/issues/106
[#107]: https://github.com/dahlia/optique/issues/107

### @optique/config

The *@optique/config* package was introduced in this release, providing
configuration file support with type-safe validation using [Standard Schema].
[[#84], [#90]]

 -  Added `createConfigContext()` function for creating configuration contexts
    with Standard Schema validation.

 -  Added `bindConfig()` function to bind parsers to configuration values with
    automatic fallback handling.

 -  Added `runWithConfig()` function for running parsers with two-pass parsing
    to load and validate configuration files. The function delegates to
    `runWith()` internally, automatically providing help, version, and shell
    completion support. These features work even when config files are missing
    or invalid, ensuring users can always access help documentation. [[#93]]

 -  Added `ConfigContext` interface implementing `SourceContext` for composable
    data source integration.

 -  Added `configKey` symbol for storing config data in annotations.

 -  Added `SingleFileOptions` interface for single-file config loading with
    optional `fileParser` for custom file formats.

 -  Added `CustomLoadOptions` interface with `load` callback for multi-file
    merging scenarios (system, user, project config cascading).

 -  `RunWithConfigOptions` is a discriminated union of `SingleFileOptions`
    and `CustomLoadOptions`.

The package uses a two-phase parsing approach to ensure proper priority
(CLI > config file > default values). See the [config file integration guide]
for usage examples.

[Standard Schema]: https://standardschema.dev/
[config file integration guide]: https://optique.dev/integrations/config
[#84]: https://github.com/dahlia/optique/issues/84
[#90]: https://github.com/dahlia/optique/issues/90
[#93]: https://github.com/dahlia/optique/issues/93

### @optique/run

 -  Added `contexts` option to `run()`, `runSync()`, and `runAsync()` for
    source context support.  When provided, the runner delegates to
    `runWith()` (or `runWithSync()`) from `@optique/core/facade`, which
    handles annotation collection, two-phase parsing, and context disposal
    automatically.  Context-specific options (e.g., `getConfigPath`, `load`)
    are passed through alongside the standard runner options.  [[#110]]

    ~~~~ typescript
    import { runAsync } from "@optique/run";

    const result = await runAsync(parser, {
      contexts: [configContext],
      getConfigPath: (parsed) => parsed.config,
      help: "both",
    });
    ~~~~

 -  Updated `run()`, `runSync()`, and `runAsync()` to accept `Program` objects
    directly. The new API automatically extracts program name and metadata from
    the `Program` object. Both the new `Program`-based API and the original
    `parser`-based API are supported. [[#82]]

    ~~~~ typescript
    import { run } from "@optique/run";

    // Program-based API (recommended for applications with metadata)
    const result = run(prog, {
      help: "both",
      colors: true,
    });

    // Parser-based API (useful for simple scripts)
    const result = run(parser, {
      programName: "myapp",
      help: "both",
      colors: true,
      brief: message`A sample CLI application`,
      // ...
    });
    ~~~~

 -  Added `completion.helpVisibility` to `run()` options. This controls whether
    completion aliases are shown in help and usage output (`"singular"`,
    `"plural"`, `"both"`, or `"none"`) independently from which aliases are
    accepted at runtime via `completion.name`. [[#99]]

 -  Added `showChoices` option to `run()`, `runSync()`, and `runAsync()`.
    This passes through to the underlying `formatDocPage()` call, enabling
    valid choice values to be displayed in help output.  [[#106]]

 -  Added `group` option for help, version, and completion configurations.
    When specified, the corresponding meta-command appears under a titled
    section in help output.  The `group` option is available when the mode
    is `"command"` or `"both"` (blocked at the type level for `"option"` mode).
    [[#107]]

    ~~~~ typescript
    import { run } from "@optique/run";

    run(parser, {
      help: { mode: "both", group: "Other" },
      version: { value: "1.0.0", mode: "both", group: "Other" },
      completion: { mode: "both", group: "Other" },
    });
    ~~~~

### @optique/man

The *@optique/man* package was introduced in this release, providing
man page generation from parser metadata.  This allows CLI applications
to generate Unix man pages that stay synchronized with parser definitions.
[[#77]]

 -  Added `generateManPage()` function for generating man pages from sync
    parsers.

 -  Added `generateManPageSync()` function for explicit sync-only man page
    generation.

 -  Added `generateManPageAsync()` function for generating man pages from
    async parsers.

 -  Added `ManPageOptions` interface for configuring man page output (name,
    section, description, date, source, manual, authors, seeAlso, bugs).

 -  Added `formatDocPageAsMan()` function for converting `DocPage` objects
    to man page format.

 -  Added `formatMessageAsRoff()` function for converting Optique `Message`
    objects to roff markup.

 -  Added `escapeRoff()` function for escaping special roff characters.

 -  Added `escapeHyphens()` function for escaping hyphens in option names.

 -  Updated `generateManPage()`, `generateManPageSync()`, and
    `generateManPageAsync()` to accept `Program` objects directly.
    The metadata (`name`, `version`, `author`, `bugs`, `examples`) is
    automatically extracted from the program, eliminating duplication.
    [[#82]]

    ~~~~ typescript
    import { defineProgram } from "@optique/core/program";
    import { generateManPage } from "@optique/man";

    const prog = defineProgram({
      parser: myParser,
      metadata: {
        name: "myapp",
        version: "1.0.0",
        author: message`Hong Minhee`,
      },
    });

    // Metadata is automatically extracted
    const manPage = generateManPage(prog, { section: 1 });
    ~~~~

 -  Added `optique-man` CLI tool for generating man pages from TypeScript/JavaScript
    files that export a `Program` or `Parser`.  This enables automated man page
    generation as part of build processes.  [[#77]]

    ~~~~ bash
    # Generate man page from a Program export
    optique-man ./src/cli.ts -s 1

    # Use a named export instead of default
    optique-man ./src/cli.ts -s 1 -e myProgram

    # Write output to a file
    optique-man ./src/cli.ts -s 1 -o myapp.1
    ~~~~

    The CLI supports:

     -  Loading TypeScript files directly (Deno, Bun, Node.js 25.2.0+ native,
        or Node.js with `tsx` installed).
     -  Extracting metadata from `Program` objects or using command-line options
        for `Parser` objects.
     -  Overriding metadata via `--name`, `--date`, `--version-string`, and
        `--manual` options.

[#77]: https://github.com/dahlia/optique/issues/77


Version 0.9.10
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]


Version 0.9.9
-------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?` even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]


Version 0.9.8
-------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.


Version 0.9.7
-------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.


Version 0.9.6
-------------

Released on February 14, 2026.

### @optique/core

 -  Fixed the `completion` command appearing before user-defined commands in
    the usage line shown on parse errors.  When using `completion` in command
    mode with `or()`-combined commands, the error output now lists user commands
    first and meta-commands (version, completion, help) after them.  [[#107]]


Version 0.9.5
-------------

Released on February 13, 2026.

### @optique/core

 -  Fixed contradictory suggestion messages for subcommand-only options at the
    root command level.  Previously, when an option that belongs to a
    subcommand was entered before specifying the subcommand (for example,
    `mycli --fooflag 123` where `--fooflag` belongs to `mycli foo`), the parser
    could report `Unexpected option or subcommand` and still suggest the same
    option.  Suggestions now only include options and commands that are valid at
    the current parse position.  [[#98]]

 -  Fixed `--completion` and `--completions` without a shell value in option
    mode reporting a generic parse error.  Previously, inputs like
    `mycli --completion` could fall through to normal argument parsing and show
    `Unexpected option or subcommand`, which was misleading.  These now produce
    the dedicated completion error for a missing shell name.  [[#100]]

[#98]: https://github.com/dahlia/optique/issues/98
[#100]: https://github.com/dahlia/optique/issues/100


Version 0.9.4
-------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `mycli subcommand --help` displaying the `brief` and `description`
    passed to `run()` instead of those passed to `command()`.  Now, when
    showing help for a specific subcommand, the subcommand's own `brief`,
    `description`, and `footer` take priority over the `run()`-level values.
    The `run()`-level values are used as fallback only when the subcommand
    does not define its own.  [[#95]]

[#95]: https://github.com/dahlia/optique/issues/95


Version 0.9.3
-------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `run()` showing top-level help instead of an error when `--help`
    is used with an invalid subcommand (e.g., `mycli nonexistent --help`).
    Previously, the help handler did not validate whether the commands
    extracted before `--help` were actually recognized by the parser,
    so it silently fell back to displaying root-level help.  Now, the
    commands are validated against the parser, and an appropriate error
    message with usage information is shown instead.  [[#97]]
 -  Fixed nested subcommand help showing sibling subcommand usage lines.
    Previously, when using `or(topLevel, command("nested", or(foo, bar)))`,
    running `mycli nested foo --help` would incorrectly display usage lines
    for both `foo` and `bar` subcommands.  Now, only the selected subcommand's
    usage is shown.  [[#96]]

[#96]: https://github.com/dahlia/optique/issues/96
[#97]: https://github.com/dahlia/optique/issues/97


Version 0.9.2
-------------

Released on January 30, 2026.

### @optique/core

 -  Fixed `command()` with `hidden: true` incorrectly hiding inner
    argument/option descriptions when the hidden command is matched and
    executed.  Previously, when a hidden command was invoked with `--help`,
    the help text would not show descriptions for the command's arguments
    and options, even when those arguments and options were not hidden.
    Now, the `hidden` option only applies when the command is shown in a
    command list (when the command is not matched), and inner parser
    documentation is displayed normally when the hidden command is actually
    executed.  [[#88]]

 -  Fixed `formatUsage()` incorrectly showing hidden commands in expanded
    usage lines.  Previously, when using `expandCommands: true` option,
    hidden commands would appear in the usage output even though they were
    correctly excluded from the command list.  Now, hidden commands are
    filtered out from expanded usage lines while remaining fully functional
    for parsing.

[#88]: https://github.com/dahlia/optique/issues/88


Version 0.9.1
-------------

Released on January 19, 2026.

### @optique/core

 -  Fixed `command()` failing to parse inner parser when buffer is empty after
    command match.  Previously, when using `command()` with an inner parser
    that can succeed with zero tokens (like `longestMatch()` or `object()` with
    all optional fields), parsing `["dev"]` would fail with “No matching option,
    command, or argument found” even though the inner parser should succeed.
    Now, the `complete()` method first gives the inner parser a chance to run
    with an empty buffer before completing.  [[#81]]

[#81]: https://github.com/dahlia/optique/issues/81


Version 0.9.0
-------------

Released on January 6, 2026.

### @optique/core

 -  Added sync/async mode support to `Parser` and `ValueParser` interfaces.
    The new `M extends Mode = "sync"` type parameter enables type-safe
    distinction between synchronous and asynchronous parsers.  [[#52], [#70]]

    New types:

     -  `Mode`: Type alias for `"sync" | "async"`.
     -  `ModeValue<M, T>`: Returns `T` for sync mode, `Promise<T>` for async.
     -  `ModeIterable<M, T>`: Returns `Iterable<T>` for sync, `AsyncIterable<T>`
        for async.
     -  `CombineModes<T extends readonly Mode[]>`: Returns `"async"` if any
        element is `"async"`, otherwise `"sync"`.
     -  `InferMode<P>`: Extracts the mode from a parser type.

    All parsers now include a `$mode` property indicating their execution mode.
    Combinators automatically propagate modes from their constituent parsers,
    resulting in `"async"` mode if any child parser is async.

    New functions for explicit mode handling:

     -  `parseSync()`: Parses with a sync-only parser, returning directly.
     -  `parseAsync()`: Parses with any parser, returning a Promise.
     -  `suggestSync()`: Gets suggestions from a sync-only parser.
     -  `suggestAsync()`: Gets suggestions from any parser as a Promise.
     -  `getDocPageSync()`: Gets documentation page from a sync-only parser.
     -  `getDocPageAsync()`: Gets documentation page from any parser as a Promise.
     -  `runParserSync()`: Runs a sync-only parser, returning the result directly.
     -  `runParserAsync()`: Runs any parser, returning a Promise of the result.

    This change is backward compatible.  Existing code continues to work
    unchanged as all parsers default to sync mode.

    ~~~~ typescript
    import type { ValueParser } from "@optique/core/valueparser";
    import { integer } from "@optique/core/valueparser";
    import { parseSync, parseAsync } from "@optique/core/parser";

    const args: readonly string[] = ["42"];

    // Sync parser (default)
    const syncParser: ValueParser<"sync", number> = integer();

    // Custom async parser
    const asyncParser: ValueParser<"async", string> = {
      $mode: "async",
      metavar: "REMOTE",
      async parse(input) {
        const data = await fetch(input);
        return { success: true, value: await data.text() };
      },
      format: (v) => v,
    };

    // Type-safe parsing
    const syncResult = parseSync(syncParser, args);        // Returns directly
    const asyncResult = await parseAsync(asyncParser, args); // Returns Promise
    ~~~~

 -  Fixed a shell command injection vulnerability in the shell
    completion script generators. The `programName` parameter in shell
    completion generators (`bash`, `zsh`, `fish`, `nu`, `pwsh`) was directly
    interpolated into shell scripts without validation, which could allow
    arbitrary command execution if an attacker-controlled program name was used.

    The fix adds strict validation of program names, allowing only alphanumeric
    characters, underscores, hyphens, and dots. Programs with names containing
    shell metacharacters or other special characters will now throw an error
    when generating completion scripts.

 -  Added documentation warning about potential Regular Expression Denial of
    Service (ReDoS) attacks when using the `pattern` option in `string()` value
    parser. Users providing custom patterns should be aware that maliciously
    crafted input can cause exponential backtracking in vulnerable patterns.
    The documentation recommends avoiding patterns with nested quantifiers and
    suggests using tools like *safe-regex* to validate patterns before use.

 -  Renamed `run()` function to `runParser()` to avoid naming conflict with
    `@optique/run`'s `run()` function.  IDE autocomplete was suggesting both
    functions when typing `run`, causing confusion.  The old `run()` export
    is still available but deprecated and will be removed in a future major
    version.  [[#54]]

 -  Renamed `RunError` class to `RunParserError` for consistency with the
    `runParser()` rename.  The old `RunError` export is still available but
    deprecated and will be removed in a future major version.  [[#54]]

 -  Added support for `optional()` and `withDefault()` wrappers inside `merge()`.
    Previously, `merge(optional(or(...)), object({...}))` would fail when the
    optional parser didn't match any input.  Now, parsers that succeed without
    consuming input (like `optional()` when nothing matches) are handled
    correctly, allowing the next parser in the merge to process remaining
    arguments.  [[#57]]

    ~~~~ typescript
    // Now works correctly
    const parser = merge(
      optional(
        or(
          object({ verbosity: map(multiple(flag("-v")), v => v.length) }),
          object({ verbosity: map(flag("-q"), () => 0) }),
        ),
      ),
      object({ file: argument(string()) }),
    );

    // myapp file.txt         → { file: "file.txt" }
    // myapp -v -v file.txt   → { verbosity: 2, file: "file.txt" }
    ~~~~

 -  Added `hidden` option to all primitive parsers (`option()`, `flag()`,
    `argument()`, `command()`, `passThrough()`).  When `hidden: true`, the
    parser is excluded from help text, shell completion suggestions, and
    “Did you mean?” error suggestions, while remaining fully functional for
    parsing.  This is useful for deprecated options, internal debugging flags,
    and experimental features.  [[#62]]

    ~~~~ typescript
    // Deprecated option: still works, but not shown in help
    const parser = object({
      output: option("-o", "--output", string()),
      outputLegacy: option("--out", string(), { hidden: true }),
    });

    // Internal debugging flag
    const debug = flag("--trace-internal", { hidden: true });
    ~~~~

 -  Added compile-time and runtime validation for `metavar` to reject empty
    strings.  The `metavar` property in `ValueParser` and related option
    interfaces now uses a non-empty string type (`NonEmptyString`), providing
    TypeScript errors when an empty string literal is passed.  Additionally,
    value parser factory functions (`string()`, `integer()`, `float()`,
    `choice()`, `url()`, `locale()`, `uuid()`) now throw a `TypeError` at
    runtime if an empty `metavar` is provided.  [[#63]]

     -  Added `@optique/core/nonempty` module.
     -  Added `NonEmptyString` type.
     -  Added `isNonEmptyString()` type guard function.
     -  Added `ensureNonEmptyString()` assertion function.

 -  Extended `choice()` value parser to support number literals in addition to
    strings.  This enables type-safe enumeration of numeric values like bit
    depths, port numbers, or other numeric options where only specific values
    are valid.  [[#64]]

    ~~~~ typescript
    // Bit depth choice - returns ValueParser<8 | 10 | 12>
    const bitDepth = choice([8, 10, 12]);

    // Port selection
    const port = choice([80, 443, 8080]);
    ~~~~

    The implementation uses function overloads to provide proper type inference
    for both string and number choices.  The `caseInsensitive` option remains
    available only for string choices, enforced at the type level.

     -  Added `ChoiceOptionsBase` interface.
     -  Added `ChoiceOptionsString` interface.
     -  Added `ChoiceOptionsNumber` interface.
     -  Deprecated `ChoiceOptions` interface in favor of `ChoiceOptionsString`.

 -  Added `valueSet()` function for formatting choice lists with locale-aware
    separators.  This function uses `Intl.ListFormat` to format lists according
    to locale conventions with appropriate conjunctions like “and” or
    “or”, making it suitable for error messages in `choice()` value parsers
    and similar contexts.

    ~~~~ typescript
    import { message, valueSet } from "@optique/core/message";

    const choices = ["error", "warn", "info"];

    // Conjunction: "error", "warn" and "info"
    const msg1 = message`Expected ${valueSet(choices)}.`;

    // Disjunction: "error", "warn" or "info"
    const msg2 = message`Expected ${valueSet(choices, { type: "disjunction" })}.`;

    // Korean: "error", "warn" 또는 "info"
    const msg3 = message`${valueSet(choices, { locale: "ko", type: "disjunction" })}`;
    ~~~~

    The exact formatting depends on the locale.  If no locale is specified,
    `valueSet()` uses the system default locale, which may vary across
    environments.  For consistent formatting, specify a locale explicitly.

     -  Added `ValueSetOptions` interface.
     -  Added `valueSet()` function.

[#52]: https://github.com/dahlia/optique/issues/52
[#54]: https://github.com/dahlia/optique/issues/54
[#57]: https://github.com/dahlia/optique/issues/57
[#62]: https://github.com/dahlia/optique/issues/62
[#63]: https://github.com/dahlia/optique/issues/63
[#64]: https://github.com/dahlia/optique/issues/64
[#70]: https://github.com/dahlia/optique/pull/70

### @optique/run

 -  Added sync/async mode support to the `run()` function.  [[#52], [#70]]

    New functions for explicit mode handling:

     -  `runSync()`: Runs with a sync-only parser, returning the parsed value
        directly.
     -  `runAsync()`: Runs with any parser, returning a `Promise` of the parsed
        value.

    The existing `run()` function continues to work unchanged for sync parsers.
    For async parsers, use `runAsync()` or `await run()`.

    ~~~~ typescript
    import { run, runSync, runAsync } from "@optique/run";
    import { object } from "@optique/core/constructs";
    import { option } from "@optique/core/primitives";
    import { string } from "@optique/core/valueparser";

    // Example sync parser
    const syncParser = object({ name: option("-n", string()) });

    // Example async parser (with async value parser)
    const asyncParser = object({
      data: option("-d", {
        $mode: "async",
        metavar: "URL",
        async parse(input) {
          const res = await fetch(input);
          return { success: true, value: await res.text() };
        },
        format: (v) => v,
      }),
    });

    // Sync parser (default behavior, unchanged)
    const syncResult = run(syncParser);

    // Explicit sync-only (compile error if parser is async)
    const syncOnlyResult = runSync(syncParser);

    // Async parser support
    const asyncResult = await runAsync(asyncParser);
    ~~~~

 -  Added `mustNotExist` option to the `path()` value parser.  When set to
    `true`, the parser rejects paths that already exist on the filesystem,
    which is useful for output files to prevent accidental overwrites.  [[#56]]

    ~~~~ typescript
    // Output file must not exist
    const outputFile = path({ mustNotExist: true });

    // With extension validation
    const reportFile = path({
      mustNotExist: true,
      extensions: [".json", ".csv"]
    });
    ~~~~

 -  Refactored `PathOptions` into a discriminated union type to enforce mutual
    exclusivity between `mustExist` and `mustNotExist` options at compile time.
    Setting both to `true` now produces a TypeScript error instead of undefined
    runtime behavior.  [[#56]]

 -  Added `pathAlreadyExists` error customization option to `PathErrorOptions`
    for the `path()` value parser.  This allows custom error messages when
    a path already exists while using the `mustNotExist` option.  [[#56]]

 -  The `path()` value parser now validates that `metavar` is non-empty,
    throwing a `TypeError` if an empty string is provided.  [[#63]]

[#56]: https://github.com/dahlia/optique/issues/56

### @optique/temporal

 -  All temporal value parsers now validate that `metavar` is non-empty,
    throwing a `TypeError` if an empty string is provided.  [[#63]]

### @optique/git

The *@optique/git* package was introduced in this release, providing
async value parsers for validating Git references (branches, tags, commits,
remotes) using [isomorphic-git].  [[#71], [#72]]

 -  Added `gitBranch()` value parser for validating local branch names.
 -  Added `gitRemoteBranch(remote)` value parser for validating remote branch
    names on a specified remote.
 -  Added `gitTag()` value parser for validating tag names.
 -  Added `gitRemote()` value parser for validating remote names.
 -  Added `gitCommit()` value parser for validating commit SHAs (full or
    shortened).
 -  Added `gitRef()` value parser for validating any Git reference (branches,
    tags, or commits).
 -  Added `createGitParsers()` factory function for creating parsers with
    shared configuration.
 -  Added `GitParsers` interface for the factory return type.
 -  Added `GitParserOptions` interface for parser configuration.
 -  Added automatic shell completion suggestions for branches, tags, remotes,
    and commits.

[isomorphic-git]: https://github.com/isomorphic-git/isomorphic-git
[#71]: https://github.com/dahlia/optique/issues/71
[#72]: https://github.com/dahlia/optique/pull/72


Version 0.8.16
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]


Version 0.8.15
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?` even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]


Version 0.8.14
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.


Version 0.8.13
--------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.


Version 0.8.12
--------------

Released on February 14, 2026.

### @optique/core

 -  Fixed the `completion` command appearing before user-defined commands in
    the usage line shown on parse errors.  When using `completion` in command
    mode with `or()`-combined commands, the error output now lists user commands
    first and meta-commands (version, completion, help) after them.  [[#107]]


Version 0.8.11
--------------

Released on February 13, 2026.

### @optique/core

 -  Fixed contradictory suggestion messages for subcommand-only options at the
    root command level.  Previously, when an option that belongs to a
    subcommand was entered before specifying the subcommand (for example,
    `mycli --fooflag 123` where `--fooflag` belongs to `mycli foo`), the parser
    could report `Unexpected option or subcommand` and still suggest the same
    option.  Suggestions now only include options and commands that are valid at
    the current parse position.  [[#98]]

 -  Fixed `--completion` and `--completions` without a shell value in option
    mode reporting a generic parse error.  Previously, inputs like
    `mycli --completion` could fall through to normal argument parsing and show
    `Unexpected option or subcommand`, which was misleading.  These now produce
    the dedicated completion error for a missing shell name.  [[#100]]


Version 0.8.10
--------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `mycli subcommand --help` displaying the `brief` and `description`
    passed to `run()` instead of those passed to `command()`.  Now, when
    showing help for a specific subcommand, the subcommand's own `brief`,
    `description`, and `footer` take priority over the `run()`-level values.
    The `run()`-level values are used as fallback only when the subcommand
    does not define its own.  [[#95]]


Version 0.8.9
-------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `run()` showing top-level help instead of an error when `--help`
    is used with an invalid subcommand (e.g., `mycli nonexistent --help`).
    Previously, the help handler did not validate whether the commands
    extracted before `--help` were actually recognized by the parser,
    so it silently fell back to displaying root-level help.  Now, the
    commands are validated against the parser, and an appropriate error
    message with usage information is shown instead.  [[#97]]
 -  Fixed nested subcommand help showing sibling subcommand usage lines.
    Previously, when using `or(topLevel, command("nested", or(foo, bar)))`,
    running `mycli nested foo --help` would incorrectly display usage lines
    for both `foo` and `bar` subcommands.  Now, only the selected subcommand's
    usage is shown.  [[#96]]


Version 0.8.8
-------------

Released on January 19, 2026.

### @optique/core

 -  Fixed `command()` failing to parse inner parser when buffer is empty after
    command match.  Previously, when using `command()` with an inner parser
    that can succeed with zero tokens (like `longestMatch()` or `object()` with
    all optional fields), parsing `["dev"]` would fail with “No matching option,
    command, or argument found” even though the inner parser should succeed.
    Now, the `complete()` method first gives the inner parser a chance to run
    with an empty buffer before completing.  [[#81]]


Version 0.8.7
-------------

Released on January 5, 2026.

### @optique/core

 -  Fixed `multiple()` parser suggesting already-selected values in shell
    completion.  Previously, when using `multiple(argument(choice(...)))` or
    similar patterns, values that had already been selected would continue
    to appear in completion suggestions.  Now, the `suggest()` method filters
    out values that have already been parsed, providing a cleaner completion
    experience.  [[#73]]

[#73]: https://github.com/dahlia/optique/issues/73


Version 0.8.6
-------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g.,
    `object({ [sym]: option(...) })`), the symbol-keyed parsers were silently
    ignored because `Object.entries()` and `for...in` loops do not enumerate
    symbol properties.  Now, the parser correctly handles both string and
    symbol keys by using `Reflect.ownKeys()`.


Version 0.8.5
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed subcommand help display when using `merge()` with `or()`.
    Previously, when combining parsers using `merge(..., or(...))`, the help
    output would fail to display subcommand-specific options because `merge()`
    did not correctly propagate the runtime state of parsers with undefined
    initial state.  Now, the state is correctly resolved, ensuring that
    subcommand help is generated correctly.  [[#69]]

 -  Fixed subcommand help displaying incorrect usage line when using
    `longestMatch()` with nested subcommands.  Previously, when using patterns
    like `longestMatch(merge(globalOptions, or(sub1, sub2)), helpCommand)`,
    the usage line in `help COMMAND` output would show all subcommand
    alternatives instead of only the selected subcommand's usage.  Now, the
    usage line correctly displays only the relevant subcommand.

[#69]: https://github.com/dahlia/optique/issues/69


Version 0.8.4
-------------

Released on December 30, 2025.

### @optique/core

 -  Added default descriptions for built-in `help` command argument and
    completion option arguments. Previously, these arguments showed no help
    text. Now they display helpful default descriptions in help output.

 -  Fixed subcommand help not displaying option descriptions in some edge cases.
    When using `help COMMAND` or `COMMAND --help`, the help output now
    correctly passes the inner parser's initial state for documentation
    generation when the command is matched but the inner parser hasn't started
    yet.  Previously, it passed `unavailable` state which could cause issues
    with parsers that depend on state for documentation.  [[#68]]

[#68]: https://github.com/dahlia/optique/issues/68

### @optique/logtape

 -  Added default descriptions for `verbosity()`, `debug()`, and `logOutput()`
    parsers. Previously, these parsers showed no help text unless users
    explicitly provided a `description` option. Now they display helpful
    default descriptions in help output.


Version 0.8.3
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.
    [[#67]]

[#67]: https://github.com/dahlia/optique/issues/67


Version 0.8.2
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal
    types are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]

[#58]: https://github.com/dahlia/optique/issues/58


Version 0.8.1
-------------

Released on December 16, 2025.

### @optique/core

 -  Fixed shell completion scripts using singular form (`completion`,
    `--completion`) even when `completion.name` is set to `"plural"`.  Now,
    when the name is `"plural"`, the generated scripts correctly use
    `completions` or `--completions` instead of the singular form.  [[#53]]

 -  Fixed shell completion suggestions including positional argument values
    when completing an option that expects a value.  For example, when
    completing `--remote ""` in a parser with both `--remote` option and
    positional tag arguments, only the remote values are now suggested,
    not the tag values.  [[#55]]

[#53]: https://github.com/dahlia/optique/issues/53
[#55]: https://github.com/dahlia/optique/issues/55


Version 0.8.0
-------------

Released on December 9, 2025.

### @optique/core

 -  Added `conditional()` combinator for discriminated union patterns where
    certain options depend on a discriminator option value. This enables
    context-dependent parsing where different sets of options become valid
    based on the discriminator selection.  [[#49]]

    ~~~~ typescript
    const parser = conditional(
      option("--reporter", choice(["console", "junit", "html"])),
      {
        console: object({}),
        junit: object({ outputFile: option("--output-file", string()) }),
        html: object({ outputFile: option("--output-file", string()) }),
      }
    );
    // Result type: ["console", {}] | ["junit", { outputFile: string }] | ...
    ~~~~

    Key features:

     -  Explicit discriminator option determines which branch is selected
     -  Tuple result `[discriminator, branchValue]` for clear type narrowing
     -  Optional default branch for when discriminator is not provided
     -  Clear error messages indicating which options are required for each
        discriminator value

 -  Added `literal` type to `UsageTerm` for representing fixed string values in
    usage descriptions. Unlike metavars (which are placeholders displayed with
    special formatting), literals are displayed as plain text. This is used
    internally by `conditional()` to show actual discriminator values in help
    text (e.g., `--reporter console` instead of `--reporter TYPE`).  [[#49]]

 -  Added `passThrough()` parser for building wrapper CLI tools that need to
    forward unrecognized options to an underlying tool. This parser captures
    unknown options without validation errors, enabling legitimate wrapper/proxy
    patterns.  [[#35]]

    ~~~~ typescript
    const parser = object({
      debug: option("--debug"),
      extra: passThrough(),
    });

    // mycli --debug --foo=bar --baz=qux
    // → { debug: true, extra: ["--foo=bar", "--baz=qux"] }
    ~~~~

    Key features:

     -  Three capture formats: `"equalsOnly"` (default, safest), `"nextToken"`
        (captures `--opt val` pairs), and `"greedy"` (captures all remaining
        tokens)
     -  Lowest priority (−10) ensures explicit parsers always match first
     -  Respects `--` options terminator in `"equalsOnly"` and `"nextToken"`
        modes
     -  Works seamlessly with `object()`, subcommands, and other combinators

 -  Added `passthrough` type to `UsageTerm` for representing pass-through
    options in usage descriptions. Displayed as `[...]` in help text.

 -  Fixed `integer()` value parser to accept negative integers when using
    `type: "number"`. Previously, the regex pattern only matched non-negative
    integers (`/^\d+$/`), causing inputs like `-42` to be rejected as invalid.
    The pattern has been updated to `/^-?\d+$/` to correctly handle negative
    values. Note that `type: "bigint"` already accepted negative integers via
    `BigInt()` conversion, so this change brings consistency between the two
    types.

[#35]: https://github.com/dahlia/optique/issues/35
[#49]: https://github.com/dahlia/optique/issues/49

### @optique/logtape

The *@optique/logtape* package was introduced in this release, providing
integration with the [LogTape] logging library. This package enables
configuring LogTape logging through command-line arguments with various
parsing strategies.

 -  Added `logLevel()` value parser for parsing log level strings (`"trace"`,
    `"debug"`, `"info"`, `"warning"`, `"error"`, `"fatal"`) into LogTape's
    `LogLevel` type. Parsing is case-insensitive and provides shell completion
    suggestions.

 -  Added `verbosity()` parser for accumulating `-v` flags to determine log
    level. Each additional `-v` flag increases verbosity: no flags →
    `"warning"`, `-v` → `"info"`, `-vv` → `"debug"`, `-vvv` → `"trace"`.

 -  Added `debug()` parser for simple `--debug`/`-d` flag that toggles between
    normal level (`"info"`) and debug level (`"debug"`).

 -  Added `logOutput()` parser for log output destination. Accepts `-` for
    console output or a file path for file output, following CLI conventions.

 -  Added `loggingOptions()` preset that combines log level and log output
    options into a single `group()`. Uses a discriminated union configuration
    to enforce mutually exclusive level selection methods (`"option"`,
    `"verbosity"`, or `"debug"`).

 -  Added `createLoggingConfig()` helper function that converts parsed logging
    options into a LogTape `Config` object for use with `configure()`.

 -  Added `createConsoleSink()` function for creating console sinks with
    configurable stream selection (stdout/stderr) and level-based stream
    resolution.

 -  Added `createSink()` async function that creates LogTape sinks from
    `LogOutput` values. File output requires the optional `@logtape/file`
    package.

[LogTape]: https://logtape.org/


Version 0.7.18
--------------

Released on February 19, 2026.

### @optique/core

 -  Fixed meta commands (`help`, `version`, `completion`, `completions`)
    disappearing from the subcommand list in help output when the parser uses
    a `withDefault(or(...))` construct.  The root cause was that
    `getDocPage()` used a `do...while` loop, which ran the parser at least
    once even with an empty argument buffer.  Because `withDefault(or(...))`
    allows the inner parser to succeed without consuming any tokens, the
    `longestMatch` combinator would record the user's parser as “selected”
    and subsequently return only that parser's doc fragments—silently
    dropping the meta command entries.  The loop is now a `while` loop that
    skips parsing entirely when the buffer is empty.  [[#121]]


Version 0.7.17
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed how `brief` and `description` are displayed in subcommand help
    pages.  [[#118], [#119]]

     -  Each help page now shows `brief` at the very top (before the Usage
        line) and `description` below the Usage line, consistent with how
        the root-level help page works.

     -  The `run()`-level `brief` and `description` no longer bleed into a
        subcommand's help page.  Previously, when a subcommand had no
        `description` of its own, the description supplied to `run()` would
        appear on the subcommand's help page (e.g. `repro file --help` would
        show “Description for repro CLI” even though that text describes the
        top-level program, not the `file` subcommand).  Now, only the
        subcommand's own `brief` and `description` (if any) are shown;
        run-level docs are used only for the root-level help page.

     -  When `command()` is wrapped with `group()`, the command's `brief`,
        `description`, and `footer` are now correctly forwarded to the help
        page.  Previously `group()` only forwarded `description`, so `brief`
        was silently dropped and the run-level brief appeared instead.

 -  Fixed contradictory “Did you mean?” suggestion when a subcommand name is
    provided at the wrong level.  Previously, a structure like
    `command("file", or(add, remove))` given the input `add --help` would
    report `Expected command file, but got add.` and then illogically suggest
    `Did you mean add?`—even though `add` is only valid *inside* `file`.
    Suggestions in `command()` errors now derive from
    `extractLeadingCommandNames()`, which limits candidates to commands that
    are actually valid at the current parse position, not commands nested
    inside other commands.  The same scoping is applied when a custom
    `notMatched` callback receives its `suggestions` argument.  [[#117]]

 -  Fixed `group()` label leaking into a selected subcommand's own nested
    command list.  Previously, when a `group()`-wrapped command (e.g.,
    `alias`) itself contained further subcommands (e.g., `delete`, `set`),
    viewing `alias --help` would show those inner commands under the outer
    group's label (e.g., “Additional commands:”), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]


Version 0.7.16
--------------

Released on February 18, 2026.

### @optique/core

 -  Fixed `group()` incorrectly applying its label to subcommand flags
    in help output.  When `group()` wraps `command()` parsers (via `or()`),
    the group label is now only shown for the command list at the top level,
    not for the inner flags/options after a command is selected.  [[#114]]

 -  Fixed `merge()` not propagating `brief`, `description`, and `footer`
    from inner parsers in help output.  When using the
    `merge(or(...commands), globalOptions)` pattern, subcommand help
    (e.g., `myapp subcommand --help`) now correctly displays the command's
    description.  Previously, these fields were silently discarded by
    `merge()`.


Version 0.7.15
--------------

Released on February 17, 2026.

### @optique/core

 -  Fixed usage string collapsing to a single line when `completion` with
    `name: "both"` created a nested exclusive term (e.g.,
    `(completion | completions)`) inside an outer exclusive.
    `normalizeUsageTerm()` now distributes an exclusive that appears as the
    first term of a branch across the remaining terms, so that
    `[exclusive(A, B), C]` is flattened into separate branches `[A, C]` and
    `[B, C]`.  This allows `formatUsage()` with `expandCommands: true` to
    properly render each alternative on its own line.


Version 0.7.14
--------------

Released on February 14, 2026.

### @optique/core

 -  Fixed the `completion` command appearing before user-defined commands in
    the usage line shown on parse errors.  When using `completion` in command
    mode with `or()`-combined commands, the error output now lists user commands
    first and meta-commands (version, completion, help) after them.  [[#107]]


Version 0.7.13
--------------

Released on February 13, 2026.

### @optique/core

 -  Fixed contradictory suggestion messages for subcommand-only options at the
    root command level.  Previously, when an option that belongs to a
    subcommand was entered before specifying the subcommand (for example,
    `mycli --fooflag 123` where `--fooflag` belongs to `mycli foo`), the parser
    could report `Unexpected option or subcommand` and still suggest the same
    option.  Suggestions now only include options and commands that are valid at
    the current parse position.  [[#98]]

 -  Fixed `--completion` and `--completions` without a shell value in option
    mode reporting a generic parse error.  Previously, inputs like
    `mycli --completion` could fall through to normal argument parsing and show
    `Unexpected option or subcommand`, which was misleading.  These now produce
    the dedicated completion error for a missing shell name.  [[#100]]


Version 0.7.12
--------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `mycli subcommand --help` displaying the `brief` and `description`
    passed to `run()` instead of those passed to `command()`.  Now, when
    showing help for a specific subcommand, the subcommand's own `brief`,
    `description`, and `footer` take priority over the `run()`-level values.
    The `run()`-level values are used as fallback only when the subcommand
    does not define its own.  [[#95]]


Version 0.7.11
--------------

Released on February 12, 2026.

### @optique/core

 -  Fixed `run()` showing top-level help instead of an error when `--help`
    is used with an invalid subcommand (e.g., `mycli nonexistent --help`).
    Previously, the help handler did not validate whether the commands
    extracted before `--help` were actually recognized by the parser,
    so it silently fell back to displaying root-level help.  Now, the
    commands are validated against the parser, and an appropriate error
    message with usage information is shown instead.  [[#97]]


Version 0.7.10
--------------

Released on January 19, 2026.

### @optique/core

 -  Fixed `command()` failing to parse inner parser when buffer is empty after
    command match.  Previously, when using `command()` with an inner parser
    that can succeed with zero tokens (like `longestMatch()` or `object()` with
    all optional fields), parsing `["dev"]` would fail with “No matching option,
    command, or argument found” even though the inner parser should succeed.
    Now, the `complete()` method first gives the inner parser a chance to run
    with an empty buffer before completing.  [[#81]]


Version 0.7.9
-------------

Released on January 5, 2026.

### @optique/core

 -  Fixed `multiple()` parser suggesting already-selected values in shell
    completion.  Previously, when using `multiple(argument(choice(...)))` or
    similar patterns, values that had already been selected would continue
    to appear in completion suggestions.  Now, the `suggest()` method filters
    out values that have already been parsed, providing a cleaner completion
    experience.  [[#73]]


Version 0.7.8
-------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g.,
    `object({ [sym]: option(...) })`), the symbol-keyed parsers were silently
    ignored because `Object.entries()` and `for...in` loops do not enumerate
    symbol properties.  Now, the parser correctly handles both string and
    symbol keys by using `Reflect.ownKeys()`.


Version 0.7.7
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed subcommand help display when using `merge()` with `or()`.
    Previously, when combining parsers using `merge(..., or(...))`, the help
    output would fail to display subcommand-specific options because `merge()`
    did not correctly propagate the runtime state of parsers with undefined
    initial state.  Now, the state is correctly resolved, ensuring that
    subcommand help is generated correctly.  [[#69]]

 -  Fixed subcommand help displaying incorrect usage line when using
    `longestMatch()` with nested subcommands.  Previously, when using patterns
    like `longestMatch(merge(globalOptions, or(sub1, sub2)), helpCommand)`,
    the usage line in `help COMMAND` output would show all subcommand
    alternatives instead of only the selected subcommand's usage.  Now, the
    usage line correctly displays only the relevant subcommand.


Version 0.7.6
-------------

Released on December 30, 2025.

### @optique/core

 -  Added default descriptions for built-in `help` command argument and
    completion option arguments. Previously, these arguments showed no help
    text. Now they display helpful default descriptions in help output.

 -  Fixed subcommand help not displaying option descriptions in some edge cases.
    When using `help COMMAND` or `COMMAND --help`, the help output now
    correctly passes the inner parser's initial state for documentation
    generation when the command is matched but the inner parser hasn't started
    yet.  Previously, it passed `unavailable` state which could cause issues
    with parsers that depend on state for documentation.  [[#68]]


Version 0.7.5
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.
    [[#67]]


Version 0.7.4
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal
    types are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]


Version 0.7.3
-------------

Released on December 16, 2025.

### @optique/core

 -  Fixed shell completion scripts using singular form (`completion`,
    `--completion`) even when `completion.name` is set to `"plural"`.  Now,
    when the name is `"plural"`, the generated scripts correctly use
    `completions` or `--completions` instead of the singular form.  [[#53]]

 -  Fixed shell completion suggestions including positional argument values
    when completing an option that expects a value.  For example, when
    completing `--remote ""` in a parser with both `--remote` option and
    positional tag arguments, only the remote values are now suggested,
    not the tag values.  [[#55]]


Version 0.7.2
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when the input contains only the options terminator `"--"`.
    For example, `parse(withDefault(option("--name", string()), "Bob"), ["--"])`
    now correctly returns `"Bob"` instead of failing with “Missing option
    `--name`.”  [[#50]]

[#50]: https://github.com/dahlia/optique/issues/50


Version 0.7.1
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when used as a standalone parser with empty input.  For
    example, `parse(withDefault(option("--name", string()), "Bob"), [])` now
    correctly returns `"Bob"` instead of failing with “Expected an option,
    but got end of input.”  [[#48]]

[#48]: https://github.com/dahlia/optique/issues/48


Version 0.7.0
-------------

Released on November 25, 2025.

### @optique/core

 -  Added duplicate option name detection to parser combinators. The `object()`,
    `tuple()`, `merge()`, and `group()` combinators now validate at parse time
    that option names are unique across their child parsers. When duplicate
    option names are detected, parsing fails with a clear error message
    indicating which option name is duplicated and in which fields or positions.
    [[#37]]

     -  Added `ObjectOptions.allowDuplicates` field to opt out of validation.
     -  Added `TupleOptions` interface with `allowDuplicates` field.
     -  Added `MergeOptions` interface with `allowDuplicates` field.
     -  Added `tuple()` overloads accepting optional `TupleOptions` parameter.
     -  Added `extractOptionNames()` function to `@optique/core/usage` module.

 -  Changed parsing behavior: `object()`, `tuple()`, `merge()`, and `group()`
    now reject parsers with duplicate option names by default. Previously,
    duplicate option names would result in ambiguous parsing where the first
    matching parser consumed the option and subsequent parsers silently received
    default values. This breaking change prevents unintentional bugs from option
    name conflicts.

    To restore previous behavior, set `allowDuplicates: true` in options.
    [[#37]]

 -  The `or()` combinator continues to allow duplicate option names across
    branches since alternatives are mutually exclusive.  [[#37]]

 -  Added “Did you mean?” suggestion system for typos in option names and
    command names. When users make typos in command-line arguments, Optique
    now automatically suggests similar valid options to help them correct
    the mistake:

    ~~~~ typescript
    const parser = object({
      verbose: option("-v", "--verbose"),
      version: option("--version"),
    });

    // User types: --verbos (typo)
    const result = parse(parser, ["--verbos"]);
    // Error: No matched option for `--verbos`.
    // Did you mean `--verbose`?
    ~~~~

    The suggestion system uses Levenshtein distance to find similar names,
    suggesting up to 3 alternatives when the edit distance is at most 3
    characters and the distance ratio is at most 0.5. Comparison is
    case-insensitive by default. Suggestions work automatically for both
    option names and subcommand names in all error contexts (`option()`,
    `flag()`, `command()`, `object()`, `or()`, and `longestMatch()` parsers).
    This feature is implemented internally and requires no user configuration.
    [[#38]]

 -  Added customization support for “Did you mean?” suggestion messages.
    All parsers that generate suggestion messages now support customizing
    how suggestions are formatted or disabling them entirely through the
    `errors` option:

    ~~~~ typescript
    // Custom suggestion format for option/flag parsers
    const portOption = option("--port", integer(), {
      errors: {
        noMatch: (invalidOption, suggestions) =>
          suggestions.length > 0
            ? message`Unknown option ${invalidOption}. Try: ${values(suggestions)}`
            : message`Unknown option ${invalidOption}.`
      }
    });

    // Custom suggestion format for command parser
    const addCmd = command("add", object({}), {
      errors: {
        notMatched: (expected, actual, suggestions) =>
          suggestions && suggestions.length > 0
            ? message`Unknown command ${actual}. Similar: ${values(suggestions)}`
            : message`Expected ${expected} command.`
      }
    });

    // Custom suggestion formatter for combinators
    const config = object({
      host: option("--host", string()),
      port: option("--port", integer())
    }, {
      errors: {
        suggestions: (suggestions) =>
          suggestions.length > 0
            ? message`Available options: ${values(suggestions)}`
            : []
      }
    });
    ~~~~

    The customization system allows complete control over suggestion
    formatting while maintaining backward compatibility. When custom error
    messages are provided, they receive the array of suggestions and can
    format, filter, or disable them as needed. This enables applications
    to provide context-specific error messages that match their CLI's
    style and user expectations.  [[#38]]

     -  Extended `OptionErrorOptions` interface with `noMatch` field.
     -  Extended `FlagErrorOptions` interface with `noMatch` field.
     -  Extended `CommandErrorOptions.notMatched` signature to include
        optional `suggestions` parameter.
     -  Extended `OrErrorOptions` interface with `suggestions` field.
     -  Extended `LongestMatchErrorOptions` interface with `suggestions` field.
     -  Extended `ObjectErrorOptions` interface with `suggestions` field.

 -  Improved `formatMessage()` line break handling to distinguish between
    soft breaks (word wrap) and hard breaks (paragraph separation):

     -  Single newlines (`\n`) are now treated as soft breaks, converted to
        spaces for natural word wrapping. This allows long error messages to
        be written across multiple lines in source code while rendering as
        continuous text.

     -  Double or more consecutive newlines (`\n\n+`) are treated as hard
        breaks, creating actual paragraph separations in the output.

    This change improves the readability of multi-part error messages, such
    as those with “Did you mean?” suggestions, by ensuring proper spacing
    between the base error and suggestions:

    ~~~~
    Error: Unexpected option or subcommand: comit.
    Did you mean commit?
    ~~~~

    Previously, single newlines in `text()` terms would be silently dropped
    during word wrapping, causing messages to run together without spacing.

 -  Improved error messages for `or()`, `longestMatch()`, and `object()`
    combinators to provide context-aware feedback based on expected input types.
    Error messages now accurately reflect what's missing (options, commands, or
    arguments) instead of showing generic “No matching option or command found”
    for all cases. [[#45]]

    ~~~~ typescript
    // When only arguments are expected
    const parser1 = or(argument(string()), argument(integer()));
    // Error: Missing required argument.

    // When only commands are expected
    const parser2 = or(command("add", ...), command("remove", ...));
    // Error: No matching command found.

    // When both options and arguments are expected
    const parser3 = object({
      port: option("--port", integer()),
      file: argument(string()),
    });
    // Error: No matching option or argument found.
    ~~~~

 -  Added function-form support for `errors.noMatch` option in `or()`,
    `longestMatch()`, and `object()` combinators. Error messages can now be
    dynamically generated based on context, enabling use cases like
    internationalization:

    ~~~~ typescript
    const parser = or(
      command("add", constant("add")),
      command("remove", constant("remove")),
      {
        errors: {
          noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
            if (hasCommands && !hasOptions && !hasArguments) {
              return message`일치하는 명령을 찾을 수 없습니다.`; // Korean
            }
            return message`잘못된 입력입니다.`;
          }
        }
      }
    );
    ~~~~

    The callback receives a `NoMatchContext` object with boolean flags
    (`hasOptions`, `hasCommands`, `hasArguments`) indicating what types of
    inputs are expected. This allows generating language-specific or
    context-specific error messages while maintaining backward compatibility
    with static message form. [[#45]]

     -  Added `NoMatchContext` interface.
     -  Extended `OrErrorOptions.noMatch` to accept
        `Message | ((context: NoMatchContext) => Message)`.
     -  Extended `LongestMatchErrorOptions.noMatch` to accept
        `Message | ((context: NoMatchContext) => Message)`.
     -  Extended `ObjectErrorOptions.endOfInput` to accept
        `Message | ((context: NoMatchContext) => Message)`.
     -  Added `extractArgumentMetavars()` function to
        `@optique/core/usage` module.

 -  Added configuration for shell completion naming conventions. The `run()`
    function now supports both singular (`completion`, `--completion`) and
    plural (`completions`, `--completions`) naming styles. By default, both
    forms are accepted (`"both"`), but this can be restricted to just one style
    using the new `name` option in the completion configuration:

    ~~~~ typescript
    run(parser, {
      completion: {
        // Use "completions" and "--completions" only
        name: "plural",
      }
    });
    ~~~~

    This allows CLI tools to match their preferred style guide or exist alongside
    other commands. The help text examples automatically reflect the configured
    naming style. [[#42]]

     -  Added `name` option to `RunOptions.completion` configuration (`"singular"`,
        `"plural"`, or `"both"`).

[#37]: https://github.com/dahlia/optique/issues/37
[#38]: https://github.com/dahlia/optique/issues/38
[#42]: https://github.com/dahlia/optique/issues/42
[#45]: https://github.com/dahlia/optique/issues/45

### @optique/valibot

The *@optique/valibot* package was introduced in this release, providing
integration with the [Valibot] validation library. This package enables using
Valibot schemas as value parsers, bringing Valibot's powerful validation
capabilities with a significantly smaller bundle size (~10KB vs Zod's ~52KB)
to command-line argument parsing. Supports Valibot version 0.42.0 and above.
[[#40]]

 -  Added `valibot()` value parser for validating command-line arguments using
    Valibot schemas.
 -  Added `ValibotParserOptions` interface for configuring metavar and custom
    error messages.
 -  Added automatic metavar inference from Valibot schema types (`STRING`,
    `EMAIL`, `NUMBER`, `INTEGER`, `CHOICE`, etc.).

[Valibot]: https://valibot.dev/
[#40]: https://github.com/dahlia/optique/issues/40

### @optique/zod

The *@optique/zod* package was introduced in this release, providing
integration with the [Zod] validation library. This package enables using
Zod schemas as value parsers, bringing Zod's powerful validation capabilities
to command-line argument parsing. Supports both Zod v3.25.0+ and v4.0.0+.
[[#39]]

 -  Added `zod()` value parser for validating command-line arguments using
    Zod schemas.
 -  Added `ZodParserOptions` interface for configuring metavar and custom
    error messages.

[Zod]: https://zod.dev/
[#39]: https://github.com/dahlia/optique/issues/39


Version 0.6.11
--------------

Released on January 5, 2026.

### @optique/core

 -  Fixed `multiple()` parser suggesting already-selected values in shell
    completion.  Previously, when using `multiple(argument(choice(...)))` or
    similar patterns, values that had already been selected would continue
    to appear in completion suggestions.  Now, the `suggest()` method filters
    out values that have already been parsed, providing a cleaner completion
    experience.  [[#73]]


Version 0.6.10
--------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g.,
    `object({ [sym]: option(...) })`), the symbol-keyed parsers were silently
    ignored because `Object.entries()` and `for...in` loops do not enumerate
    symbol properties.  Now, the parser correctly handles both string and
    symbol keys by using `Reflect.ownKeys()`.


Version 0.6.9
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed subcommand help display when using `merge()` with `or()`.
    Previously, when combining parsers using `merge(..., or(...))`, the help
    output would fail to display subcommand-specific options because `merge()`
    did not correctly propagate the runtime state of parsers with undefined
    initial state.  Now, the state is correctly resolved, ensuring that
    subcommand help is generated correctly.  [[#69]]

 -  Fixed subcommand help displaying incorrect usage line when using
    `longestMatch()` with nested subcommands.  Previously, when using patterns
    like `longestMatch(merge(globalOptions, or(sub1, sub2)), helpCommand)`,
    the usage line in `help COMMAND` output would show all subcommand
    alternatives instead of only the selected subcommand's usage.  Now, the
    usage line correctly displays only the relevant subcommand.


Version 0.6.8
-------------

Released on December 30, 2025.

### @optique/core

 -  Added default descriptions for built-in `help` command argument and
    completion option arguments. Previously, these arguments showed no help
    text. Now they display helpful default descriptions in help output.

 -  Fixed subcommand help not displaying option descriptions in some edge cases.
    When using `help COMMAND` or `COMMAND --help`, the help output now
    correctly passes the inner parser's initial state for documentation
    generation when the command is matched but the inner parser hasn't started
    yet.  Previously, it passed `unavailable` state which could cause issues
    with parsers that depend on state for documentation.  [[#68]]


Version 0.6.7
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.
    [[#67]]


Version 0.6.6
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal
    types are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]


Version 0.6.5
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when the input contains only the options terminator `"--"`.
    For example, `parse(withDefault(option("--name", string()), "Bob"), ["--"])`
    now correctly returns `"Bob"` instead of failing with “Missing option
    `--name`.”  [[#50]]


Version 0.6.4
-------------

Rleased on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when used as a standalone parser with empty input.  For
    example, `parse(withDefault(option("--name", string()), "Bob"), [])` now
    correctly returns `"Bob"` instead of failing with “Expected an option,
    but got end of input.”  [[#48]]


Version 0.6.3
-------------

Released on November 25, 2025.

### @optique/core

 -  Fixed shell completion scripts using `completion` subcommand even when
    `completion.mode` is set to `"option"`. Now, when the mode is `"option"`,
    the generated scripts correctly use `--completion` instead of `completion`.
    [[#41]]

[#41]: https://github.com/dahlia/optique/issues/41


Version 0.6.2
-------------

Released on October 27, 2025.

### @optique/core

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]

[#36]: https://github.com/dahlia/optique/issues/36

### @optique/run

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]


Version 0.6.1
-------------

Released on October 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring in Bun runtime by replacing
    reliance on default `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls. Previously,
    Bun's `console.error()` would add red coloring by default, which
    interfered with ANSI formatting in error messages. This change ensures
    consistent output formatting across all JavaScript runtimes (Node.js,
    Bun, and Deno).


Version 0.6.0
-------------

Released on October 2, 2025.

### @optique/core

 -  Added shell completion support for Bash, zsh, fish, PowerShell, and Nushell.
    Optique now provides built-in completion functionality that integrates
    seamlessly with the existing parser architecture. This allows CLI
    applications to offer intelligent suggestions for commands, options, and
    arguments without requiring additional configuration.
    [[#5], [#30], [#31], [#33]]

     -  Added `Suggestion` type.
     -  Added `Parser.suggest()` method.
     -  Added `ValueParser.suggest()` method.
     -  Added `suggest()` function.
     -  Added `@optique/core/completion` module.
     -  Added `ShellCompletion` interface.
     -  Added `bash`, `zsh`, `fish`, `pwsh`, and `nu` shell completion
        generators.
     -  Added `RunOptions.completion` option.

 -  Added `brief` and `footer` options to `command()` parser for improved
    documentation control. The `brief` option provides a short description for
    command listings (e.g., `myapp help`), while `description` is used for
    detailed help (e.g., `myapp help subcommand` or `myapp subcommand --help`).
    The `footer` option allows adding examples or additional information at the
    bottom of command-specific help text.

     -  Added `CommandOptions.brief` field.
     -  Added `CommandOptions.footer` field.
     -  Added `DocFragments.footer` field.

 -  Added `commandLine` message term type for formatting command-line examples
    in help text and error messages. This allows command-line snippets to be
    displayed with distinct styling (cyan color in terminals) to make examples
    more visually clear.

     -  Added `commandLine()` function for creating command-line message terms.
     -  Updated `MessageTerm` type to include `commandLine` variant.
     -  Updated `formatMessage()` to support styling command-line examples.

[#5]: https://github.com/dahlia/optique/issues/5
[#30]: https://github.com/dahlia/optique/issues/30
[#31]: https://github.com/dahlia/optique/issues/31
[#33]: https://github.com/dahlia/optique/issues/33

### @optique/run

 -  Added completion integration to the `run()` function. Applications can
    now enable shell completion by setting the `completion` option, which
    automatically handles completion script generation and runtime completion
    requests.  [[#5]]

     -  Added `RunOptions.completion` option.


Version 0.5.3
-------------

Released on October 27, 2025.

### @optique/core

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]

### @optique/run

 -  Fixed incorrect CommonJS type export paths in `package.json`. The
    `"require"` type paths for submodules were incorrectly pointing to
    `"*.cts"` files instead of `"*.d.cts"` files, causing type resolution
    issues when importing submodules in CommonJS environments.  [[#36]]


Version 0.5.2
-------------

Released on October 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring in Bun runtime by replacing
    reliance on default `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls. Previously,
    Bun's `console.error()` would add red coloring by default, which
    interfered with ANSI formatting in error messages. This change ensures
    consistent output formatting across all JavaScript runtimes (Node.js,
    Bun, and Deno).


Version 0.5.1
-------------

Released on September 26, 2025.

### @optique/core

 -  Fixed an issue where empty group sections were displayed in help output for
    nested subcommands. When using `group()` with nested commands, help text
    would show empty group headers when the grouped items were no longer
    available in the current command context. The `formatDocPage()` function
    now skips sections with no entries.  [[#29]]

[#29]: https://github.com/dahlia/optique/issues/29


Version 0.5.0
-------------

Released on September 23, 2025.

### @optique/core

 -  Refactored parser modules for better code organization by splitting the large
    `@optique/core/parser` module into focused, specialized modules. This
    improves maintainability, reduces module size, and provides clearer
    separation of concerns. All changes maintain full backward compatibility
    through re-exports.

     -  *Primitive parsers*: Moved primitive parsers (`constant()`, `option()`,
        `flag()`, `argument()`, `command()`) and their related types to
        a dedicated `@optique/core/primitives` module. These core building
        blocks are now logically separated from parser combinators.

     -  *Modifying combinators*: Moved parser modifier functions (`optional()`,
        `withDefault()`, `map()`, `multiple()`) and their related types to a
        dedicated `@optique/core/modifiers` module. These higher-order functions
        that transform and enhance parsers are now grouped together.

     -  *Construct combinators*: Moved parser combinators (`object()`,
        `tuple()`, `or()`, `merge()`, `concat()`, `longestMatch()`, `group()`)
        and their related types to a dedicated `@optique/core/constructs`
        module. These combinator functions that compose and combine parsers are
        now organized in a separate module.

    For backward compatibility, all functions continue to be re-exported from
    `@optique/core/parser`, so existing code will work unchanged. However, the
    recommended approach going forward is to import directly from the
    specialized modules:

    ~~~~ typescript
    // Recommended: import directly from specialized modules
    import { option, flag, argument } from "@optique/core/primitives";
    import { optional, withDefault, multiple } from "@optique/core/modifiers";
    import { object, or, merge } from "@optique/core/constructs";

    // Still supported: import everything from parser module (backward compatibility)
    import { option, flag, optional, withDefault, object, or } from "@optique/core/parser";
    ~~~~

    This refactoring only affects internal code organization and does not impact
    the public API or runtime behavior of any parsers.

 -  Added automatic error handling for `withDefault()` default value callbacks.
    When a default value callback throws an error, it is now automatically
    caught and converted to a parser-level error. This allows users to handle
    validation errors (like missing environment variables) directly at
    the parser level instead of after calling `run()`.  [[#18], [#21]]

 -  Added `WithDefaultError` class for structured error messages in
    `withDefault()` callbacks. This error type accepts a `Message` object
    instead of just a string, enabling rich formatting with colors and
    structured content in error messages. Regular errors are still supported and
    automatically converted to plain text messages.  [[#18], [#21]]

    ~~~~ typescript
    // Regular error (automatically converted to text)
    withDefault(option("--url", url()), () => {
      throw new Error("Environment variable not set");
    });

    // Structured error with rich formatting
    withDefault(option("--config", string()), () => {
      throw new WithDefaultError(
        message`Environment variable ${envVar("CONFIG_PATH")} is not set`
      );
    });
    ~~~~

 -  Added `envVar` message term type for environment variable references.
    Environment variables are displayed with bold and underline formatting
    to distinguish them from other message components like option names
    and metavariables.  The `envVar()` helper function creates environment
    variable terms for use in structured messages.

    ~~~~ typescript
    import { envVar, message } from "@optique/core/message";

    const configError = message`Environment variable ${envVar("API_URL")} is not set.`;
    // Displays: Environment variable API_URL is not set. (bold + underlined)
    ~~~~

 -  Added custom help display messages for `withDefault()` parsers. The
    `withDefault()` modifier now accepts an optional third parameter to
    customize how default values are displayed in help text. This allows
    showing descriptive text instead of actual default values, which is
    particularly useful for environment variables, computed defaults, or
    sensitive information.  [[#19]]

    ~~~~ typescript
    import { message, envVar } from "@optique/core/message";
    import { withDefault } from "@optique/core/parser";

    // Show custom help text instead of actual values
    const parser = object({
      apiUrl: withDefault(
        option("--api-url", url()),
        new URL("https://api.example.com"),
        { message: message`Default API endpoint` }
      ),
      token: withDefault(
        option("--token", string()),
        () => process.env.API_TOKEN || "",
        { message: message`${envVar("API_TOKEN")}` }
      )
    });

    // Help output shows: --token STRING [API_TOKEN]
    // Instead of the actual token value
    ~~~~

 -  Enhanced `formatMessage()` with `resetSuffix` support for better ANSI color
    handling. The `colors` option can now be an object with a `resetSuffix`
    property that maintains parent styling context after ANSI reset sequences.
    This fixes issues where dim styling was interrupted by inner ANSI codes
    in default value display.  [[#19]]

    ~~~~ typescript
    formatMessage(msg, {
      colors: { resetSuffix: "\x1b[2m" },  // Maintains dim after resets
      quotes: false
    });
    ~~~~

 -  Updated `DocEntry.default` field type from `string` to `Message` for rich
    formatting support in documentation. This change enables structured default
    value display with colors, environment variables, and other message
    components while maintaining full backward compatibility.  [[#19]]

 -  Added comprehensive error message customization system that allows
    users to customize error messages for all parser types and combinators.
    This addresses the need for better user-facing error messages in CLI
    applications by enabling context-specific error text with support for
    both static messages and dynamic error generation functions.  [[#27]]

     -  Parser error options: All primitive parsers (`option()`, `flag()`,
        `argument()`, `command()`) now accept an `errors` option to customize
        error messages:

        ~~~~ typescript
        const parser = option("--port", integer(), {
          errors: {
            missing: message`Port number is required for server operation.`,
            invalidValue: (error) => message`Invalid port: ${error}`
          }
        });
        ~~~~

     -  Combinator error options: Parser combinators (`or()`, `longestMatch()`,
        `object()`, `multiple()`) support error customization for various
        failure scenarios:

        ~~~~ typescript
        const parser = or(
          flag("--verbose"),
          flag("--quiet"),
          {
            errors: {
              noMatch: message`Please specify either --verbose or --quiet.`
            }
          }
        );
        ~~~~

     -  Value parser error customization: All value parsers now support
        customizable error messages through an `errors` option in their
        configuration. This enables application-specific error messages
        that better guide users:

        ~~~~ typescript
        // Core value parsers
        const portOption = option("--port", integer({
          min: 1024,
          max: 65535,
          errors: {
            invalidInteger: message`Port must be a whole number.`,
            belowMinimum: (value, min) =>
              message`Port ${text(value.toString())} too low. Use ${text(min.toString())} or higher.`,
            aboveMaximum: (value, max) =>
              message`Port ${text(value.toString())} too high. Maximum is ${text(max.toString())}.`
          }
        }));

        const formatOption = option("--format", choice(["json", "yaml", "xml"], {
          errors: {
            invalidChoice: (input, choices) =>
              message`Format ${input} not supported. Available: ${values(choices)}.`
          }
        }));
        ~~~~

     -  Function-based error messages: Error options can be functions that
        receive context parameters to generate dynamic error messages:

        ~~~~ typescript
        const parser = command("deploy", argument(string()), {
          errors: {
            notMatched: (expected, actual) =>
              message`Expected "${expected}" command, but got "${actual ?? "nothing"}".`
          }
        });
        ~~~~

     -  Type-safe error interfaces: Each parser type has its own error
        options interface (`OptionErrorOptions`, `FlagErrorOptions`,
        `ArgumentErrorOptions`, `CommandErrorOptions`, `ObjectOptions`,
        `MultipleOptions`, `OrOptions`, `LongestMatchOptions`) providing
        IntelliSense support and type safety.

     -  Improved default messages: Default error messages have been improved
        to be more user-friendly, changing generic messages like “No parser
        matched” to specific ones like “No matching option or command
        found.”

     -  Backward compatibility: All error customization is optional and
        maintains full backward compatibility. Existing code continues to work
        unchanged while new APIs are available when needed.

[#18]: https://github.com/dahlia/optique/discussions/18
[#19]: https://github.com/dahlia/optique/issues/19
[#21]: https://github.com/dahlia/optique/issues/21
[#27]: https://github.com/dahlia/optique/issues/27

### @optique/run

 -  Added comprehensive error message customization for the `path()` value
    parser. Path validation now supports custom error messages for all
    validation scenarios, enabling more user-friendly error messages in
    file and directory operations:

    ~~~~ typescript
    import { path } from "@optique/run/valueparser";
    import { message, values } from "@optique/core/message";

    // Configuration file with custom validation errors
    const configFile = option("--config", path({
      mustExist: true,
      type: "file",
      extensions: [".json", ".yaml", ".yml"],
      errors: {
        pathNotFound: (input) =>
          message`Configuration file ${input} not found.`,
        notAFile: message`Configuration must be a file, not a directory.`,
        invalidExtension: (input, extensions, actualExt) =>
          message`Config file ${input} has wrong extension ${actualExt}. Expected: ${values(extensions)}.`,
      }
    }));
    ~~~~

    The `PathOptions` interface now includes an `errors` field with support
    for customizing `pathNotFound`, `notAFile`, `notADirectory`,
    `invalidExtension`, and `parentNotFound` error messages. All error
    customization options support both static `Message` objects and dynamic
    functions that receive validation context parameters.  [[#27]]

### @optique/temporal

 -  Added comprehensive error message customization for all temporal value
    parsers. This enables application-specific error messages for date, time,
    and timezone validation scenarios:

    ~~~~ typescript
    import { instant, duration, timeZone } from "@optique/temporal";
    import { message } from "@optique/core/message";

    // Timestamp parser with user-friendly errors
    const startTime = option("--start", instant({
      errors: {
        invalidFormat: (input) =>
          message`Start time ${input} is invalid. Use ISO 8601 format like 2023-12-25T10:30:00Z.`,
      }
    }));

    // Duration parser with contextual errors
    const timeout = option("--timeout", duration({
      errors: {
        invalidFormat: message`Timeout must be in ISO 8601 duration format (e.g., PT30S, PT5M, PT1H).`,
      }
    }));

    // Timezone parser with helpful suggestions
    const timezone = option("--timezone", timeZone({
      errors: {
        invalidFormat: (input) =>
          message`Timezone ${input} is not valid. Use IANA identifiers like America/New_York or UTC.`,
      }
    }));
    ~~~~

    All temporal parsers (`instant()`, `duration()`, `zonedDateTime()`,
    `plainDate()`, `plainTime()`, `plainDateTime()`, `plainYearMonth()`,
    `plainMonthDay()`, `timeZone()`) now support an `errors` option with
    `invalidFormat` error message customization. This maintains consistency
    with the error customization system across all Optique packages.  [[#27]]


Version 0.4.4
-------------

Released on September 18, 2025.

### @optique/core

 -  Fixed subcommand help display bug in the `run()` function when using
    the `help` option. Previously, `cli my-cmd --help` would incorrectly
    show root-level help instead of subcommand-specific help when parsers
    were combined with `or()`. Now `--help` correctly shows help for the
    specific subcommand being used.  [[#26]]

[#26]: https://github.com/dahlia/optique/issues/26


Version 0.4.3
-------------

Released on September 16, 2025.

### @optique/temporal

 -  Fixed timezone identifier validation failure in Deno 2.5.0. The `timeZone()`
    parser now works correctly with all supported timezones by removing explicit
    zero values for hour, minute, and second fields when creating validation
    `ZonedDateTime` objects. This addresses a regression in Deno 2.5.0's
    Temporal API implementation that rejected zero values for time fields.


Version 0.4.2
-------------

Released on September 10, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]

[#22]: https://github.com/dahlia/optique/issues/22


Version 0.4.1
-------------

Released on September 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring across JavaScript runtimes
    by replacing `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls.
    Previously, runtimes like Bun would display `console.error()` output
    in red, causing ANSI reset codes in formatted option names to interrupt
    the error coloring. This change ensures consistent output formatting
    across all JavaScript runtimes.  [[#20]]

[#20]: https://github.com/dahlia/optique/issues/20


Version 0.4.0
-------------

Released on September 6, 2025.

### @optique/core

 -  Improved type inference for `tuple()` parser by using `const` type
    parameter. The generic type parameter now preserves tuple literal types
    more accurately, providing better type safety and inference when working
    with tuple parsers.

 -  Extended `merge()` combinator to support up to 10 parsers (previously
    limited to 5), allowing more complex CLI configurations with larger numbers
    of parsers to be combined into a single object structure.

 -  Added optional label parameter to `merge()` combinator for better help text
    organization. Similar to `object()`, `merge()` now accepts an optional first
    string parameter to label the merged group in documentation:

    ~~~~ typescript
    // Without label (existing usage)
    merge(apiParser, dbParser, serverParser)

    // With label (new feature)
    merge("Configuration", apiParser, dbParser, serverParser)
    ~~~~

    This addresses the inconsistency where developers had to choose between
    clean code structure using `merge()` or organized help output using labeled
    `object()` calls. The label appears as a section header in help text,
    making it easier to group related options from multiple parsers.  [[#12]]

 -  Added `group()` combinator for organizing any parser under a labeled section
    in help text. This wrapper function applies a group label to any parser for
    documentation purposes without affecting parsing behavior:

    ~~~~ typescript
    // Group mutually exclusive options
    const outputFormat = group(
      "Output Format",
      or(
        map(flag("--json"), () => "json"),
        map(flag("--yaml"), () => "yaml"),
        map(flag("--xml"), () => "xml"),
      ),
    );
    ~~~~

    Unlike `merge()` and `object()` which have built-in label support, `group()`
    can be used with any parser type (`or()`, `flag()`, `multiple()`, etc.) that
    doesn't natively support labeling. This enables clean code organization
    while maintaining well-structured help text.  [[#12]]

 -  Improved type safety for `merge()` combinator by enforcing stricter
    parameter constraints. The function now rejects parsers that return
    non-object values (arrays, primitives, etc.) at compile time,
    producing clear “No overload matches this call” errors instead of
    allowing invalid combinations that would fail at runtime:

    ~~~~ typescript
    // These now produce compile-time errors (previously allowed):
    merge(
      object({ port: option("--port", integer()) }),  // ✅ Returns object
      multiple(argument(string())),                   // ❌ Returns array
    );

    merge(
      object({ verbose: flag("--verbose") }),         // ✅ Returns object
      flag("--debug"),                                // ❌ Returns boolean
    );
    ~~~~

    This prevents a class of runtime errors where `merge()` would receive
    incompatible parser types. Existing code using `merge()` with only
    object-producing parsers (the intended usage) continues to work unchanged.

 -  Improved help and version handling in `run()` function with better edge case
    support and more consistent behavior. The implementation was refactored from
    a complex conditional parser generator into modular helper functions,
    improving maintainability and test coverage:

     -  Enhanced last-option-wins pattern: `--version --help` shows help,
        `--help --version` shows version
     -  Added support for options terminator (`--`) to prevent help/version
        flags after `--` from being interpreted as options
     -  Improved handling of multiple identical flags
        (e.g., `--version --version`)

    The public API remains unchanged - existing `run()` usage continues to work
    identically while benefiting from more robust edge case handling.  [[#13]]

 -  Added `showDefault` option to display default values in help text. When
    enabled, options and arguments created with `withDefault()` will display
    their default values in the help output:

    ~~~~ typescript
    const parser = object({
      port: withDefault(option("--port", integer()), 3000),
      format: withDefault(option("--format", string()), "json"),
    });

    // Basic usage shows: --port [3000], --format [json]
    formatDocPage("myapp", doc, { showDefault: true });

    // Custom formatting
    formatDocPage("myapp", doc, {
      showDefault: { prefix: " (default: ", suffix: ")" }
    });
    // Shows: --port (default: 3000), --format (default: json)
    ~~~~

    The feature is opt-in and backward compatible. Default values are
    automatically dimmed when colors are enabled. A new `ShowDefaultOptions`
    interface provides type-safe customization of the display format.  [[#14]]

 -  Added `brief`, `description`, and `footer` options to the `RunOptions`
    interface in the `run()` function. These fields allow users to provide
    rich documentation that appears in help text without modifying parser
    definitions:

    ~~~~ typescript
    import { run } from "@optique/core/facade";
    import { message } from "@optique/core/message";

    run(parser, "myapp", args, {
      brief: message`A powerful CLI tool for data processing`,
      description: message`This tool provides comprehensive data processing
        capabilities with support for multiple formats and transformations.`,
      footer: message`For more information, visit https://example.com`,
      help: { mode: "option" },
    });
    ~~~~

    The documentation fields appear in both help output (when `--help` is used)
    and error output (when `aboveError: "help"` is configured). These options
    augment the `DocPage` generated by `getDocPage()`, with user-provided values
    taking precedence over parser-generated content.  [[#15]]

[#12]: https://github.com/dahlia/optique/issues/12
[#13]: https://github.com/dahlia/optique/issues/13
[#14]: https://github.com/dahlia/optique/issues/14
[#15]: https://github.com/dahlia/optique/issues/15

### @optique/run

 -  Added `showDefault` option to the `RunOptions` interface. This option works
    identically to the same option in `@optique/core/facade`, allowing users
    to display default values in help text when using the process-integrated
    `run()` function:

    ~~~~ typescript
    import { run } from "@optique/run";

    const result = run(parser, {
      showDefault: true,  // Shows default values in help
      colors: true,       // With dim styling
    });
    ~~~~

    This ensures feature parity between the low-level facade API and the
    high-level run package.  [[#14]]

 -  Added `brief`, `description`, and `footer` options to the `RunOptions`
    interface. These fields provide the same rich documentation capabilities
    as the corresponding options in `@optique/core/facade`, but with the
    convenience of automatic process integration:

    ~~~~ typescript
    import { run } from "@optique/run";
    import { message } from "@optique/core/message";

    const result = run(parser, {
      brief: message`A powerful CLI tool for data processing`,
      description: message`This tool provides comprehensive data processing
        capabilities with support for multiple formats and transformations.`,
      footer: message`For more information, visit https://example.com`,
      help: "option",  // Enables --help option
      version: "1.0.0", // Enables --version option
    });
    ~~~~

    This maintains feature parity between the low-level facade API and the
    high-level run package, allowing developers to create rich CLI documentation
    regardless of which API they use.  [[#15]]

### @optique/temporal

The *@optique/temporal* package was introduced in this release, providing
parsers for JavaScript Temporal types. This package depends on
the *@js-temporal/polyfill* package for environments that do not yet
support Temporal natively.

 -  Added `TimeZone` type.
 -  Added `instant()` value parser.
 -  Added `InstantOptions` interface.
 -  Added `duration()` value parser.
 -  Added `DurationOptions` interface.
 -  added `zonedDateTime()` value parser.
 -  Added `ZonedDateTimeOptions` interface.
 -  Added `plainDate()` value parser.
 -  Added `PlainDateOptions` interface.
 -  Added `plainTime()` value parser.
 -  Added `PlainTimeOptions` interface.
 -  Added `plainDateTime()` value parser.
 -  Added `PlainDateTimeOptions` interface.
 -  Added `plainYearMonth()` value parser.
 -  Added `PlainYearMonthOptions` interface.
 -  Added `plainMonthDay()` value parser.
 -  Added `PlainMonthDayOptions` interface.
 -  Added `timeZone()` value parser.
 -  Added `TimeZoneOptions` interface.


Version 0.3.2
-------------

Released on September 10, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


Version 0.3.1
-------------

Released on September 8, 2025.

### @optique/run

 -  Fixed inconsistent error message coloring across JavaScript runtimes
    by replacing `console.error()` and `console.log()` with direct
    `process.stderr.write()` and `process.stdout.write()` calls.
    Previously, runtimes like Bun would display `console.error()` output
    in red, causing ANSI reset codes in formatted option names to interrupt
    the error coloring. This change ensures consistent output formatting
    across all JavaScript runtimes.  [[#20]]


Version 0.3.0
-------------

Released on August 29, 2025.

### @optique/core

 -  Added `flag()` parser for creating required Boolean flags that must be
    explicitly provided. Unlike `option()` which defaults to `false` when
    not present, `flag()` fails parsing when not provided, making it useful
    for dependent options and conditional parsing scenarios.

 -  Extended `or()` combinator to support up to 10 parsers (previously limited
    to 5), enabling more complex command-line interfaces with larger numbers
    of mutually exclusive subcommands or options.

 -  Enhanced `withDefault()` to support union types when the default value
    is a different type from the parser result. The result type is now
    `T | TDefault` instead of requiring the default to match the parser type.
    This enables patterns like conditional CLI structures with dependent
    options where different default structures are needed based on flag states.

 -  Modified `object()` parser to use greedy parsing behavior. The parser now
    attempts to consume all matching fields in a single parse call, rather than
    returning after the first successful field match. This enables dependent
    options patterns where multiple related options need to be parsed together
    (e.g., `--flag --dependent-option`). While this change maintains backward
    compatibility for most use cases, it may affect performance and parsing
    order in complex scenarios.

 -  Enhanced `merge()` combinator type constraints to accept any parser that
    produces object-like values, not just `object()` parsers. This enables
    combining `withDefault()`, `map()`, and other parsers that generate objects
    with `merge()`. The combinator also now properly supports parsers with
    different state management strategies using specialized state handling to
    preserve the expected state format for each parser type.

 -  Modified `Parser.getDocFragments()` method signature to use
    `DocState<TState>` discriminated union instead of direct state values.
    The new signature is `getDocFragments(state: DocState<TState>, ...args)`.
    This change improves type safety by explicitly modeling when parser state
    is available versus unavailable, fixing crashes in help generation when
    using `merge()` with `or()` combinations. This only affects advanced users
    who directly call `getDocFragments()` or implement custom parsers.

     -  Added `DocState` type.
     -  Changed the type of `Parser.getDocFragments()`'s first parameter
        from `TState` to `DocState<TState>`.

 -  Added `longestMatch()` combinator that selects the parser which consumes
    the most input tokens. Unlike `or()` which returns the first successful
    match, `longestMatch()` tries all provided parsers and chooses the one
    with the longest match. This enables context-aware parsing where more
    specific patterns take precedence over general ones, making it ideal for
    implementing sophisticated help systems where `command --help` shows
    command-specific help rather than global help. The combinator supports
    function overloads for 2–5 parsers plus a variadic version, with full
    type inference for discriminated union results.

 -  Modified `run()` function in `@optique/core/facade` to use `longestMatch()`
    instead of `or()` for help parsing. This enables context-aware help behavior
    where `subcommand --help` shows help specific to that command instead of
    global help. For example, `myapp list --help` now displays help for
    the `list` command rather than the global application help.
    This change affects all help modes (`"command"`, `"option"`, and
    `"both"`). Applications using the `run()` function will automatically
    benefit from improved help UX without code changes.

 -  Refactored `run()` function help API to group related options together for
    better type safety. The new API prevents invalid combinations and provides
    a cleaner interface:

    ~~~~ typescript
    run(parser, args, {
      help: {
        mode: "both",           // "command" | "option" | "both"
        onShow: process.exit,   // Optional callback
      }
    });
    ~~~~

 -  Added `version` functionality to the `run()` function, supporting both
    `--version` option and `version` command modes:

    ~~~~ typescript
    run(parser, args, {
      version: {
        mode: "option",         // "command" | "option" | "both"
        value: "1.0.0",         // Version string to display
        onShow: process.exit,   // Optional callback
      }
    });
    ~~~~

    The `version` configuration follows the same pattern as `help`, with
    three modes:

     -  `"option"`: Only `--version` flag is available
     -  `"command"`: Only `version` subcommand is available
     -  `"both"`: Both `--version` and `version` subcommand work

### @optique/run

 -  The `run()` function now provides context-aware help behavior,
    automatically inheriting the improvements from `@optique/core/facade`.
    Applications using `@optique/run` will see the same enhanced help system
    where `subcommand --help` shows command-specific help instead of global
    help.

 -  Simplified help API by removing the `"none"` option.
    Since disabling help can be achieved by simply omitting the `help` option,
    the explicit `"none"` value is no longer needed:

    ~~~~ typescript
    // Old API
    run(parser, { help: "none" }); // Explicitly disable help
    run(parser, { help: "both" }); // Enable help

    // New API
    run(parser, {}); // Help disabled (omit the option)
    run(parser, { help: "both" }); // Enable help: "command" | "option" | "both"
    ~~~~

    The help option now only accepts `"command" | "option" | "both"`. To
    disable help functionality, simply omit the `help` option entirely.

 -  Added `version` functionality with a flexible API that supports both
    simple string and detailed object configurations:

    ~~~~ typescript
    // Simple version configuration (uses default "option" mode)
    run(parser, { version: "1.0.0" });

    // Advanced version configuration
    run(parser, {
      version: {
        value: "1.0.0",
        mode: "both"  // "command" | "option" | "both"
      }
    });
    ~~~~

    The version functionality automatically calls `process.exit(0)` when
    version information is requested, making it suitable for CLI applications
    that need to display version and exit.

 -  Added structured message output functions for CLI applications with
    automatic terminal detection and consistent formatting:

     -  Added `print()` function for general output to stdout.
     -  Added `printError()` function for error output to stderr with automatic
        `Error: ` prefix and optional process exit.
     -  Added `createPrinter()` function for custom output scenarios with
        predefined formatting options.
     -  Added `PrintOptions` and `PrintErrorOptions` interfaces for type-safe
        configuration.
     -  Added `Printer` type for custom printer functions.

    All output functions automatically detect terminal capabilities (colors,
    width) and format structured messages consistently across different
    environments.


Version 0.2.1
-------------

Released on September 9, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


Version 0.2.0
-------------

Released on August 22, 2025.

### @optique/core

 -  Added `concat()` function for concatenating multiple `tuple()` parsers into
    a single flattened tuple, similar to how `merge()` works for `object()`
    parsers. [[#1]]

 -  Fixed an infinite loop issue in the main parsing loop that could occur when
    parsers succeeded but didn't consume input.

 -  Fixed bundled short options (e.g., `-vdf` for `-v -d -f`) not being parsed
    correctly in some cases.

[#1]: https://github.com/dahlia/optique/issues/1


Version 0.1.2
-------------

Released on September 9, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


Version 0.1.1
-------------

Released on August 21, 2025.

### @optique/core

 -  Fixed a bug where `object()` parsers containing only Boolean flags would
    fail when no arguments were provided, instead of defaulting the flags to
    `false`. [[#6]]

[#6]: https://github.com/dahlia/optique/issues/6


Version 0.1.0
-------------

Released on August 21, 2025.  Initial release.
