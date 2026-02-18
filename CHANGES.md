Optique changelog
=================

Version 0.8.16
--------------

To be released.


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
        show "Description for repro CLI" even though that text describes the
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
    group's label (e.g., "Additional commands:"), which was incorrect.
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

[#114]: https://github.com/dahlia/optique/issues/114


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

[#107]: https://github.com/dahlia/optique/issues/107


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

[#98]: https://github.com/dahlia/optique/issues/98
[#100]: https://github.com/dahlia/optique/issues/100


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

[#95]: https://github.com/dahlia/optique/issues/95


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

[#96]: https://github.com/dahlia/optique/issues/96
[#97]: https://github.com/dahlia/optique/issues/97


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

[#81]: https://github.com/dahlia/optique/issues/81


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


Version 0.8.6
-------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g., `object({ [sym]: option(...) })`),
    the symbol-keyed parsers were silently ignored because `Object.entries()`
    and `for...in` loops do not enumerate symbol properties.  Now, the parser
    correctly handles both string and symbol keys by using `Reflect.ownKeys()`.


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
    or argument found” even though `-o` was a valid option for `sub1`.  [[#67]]


Version 0.8.2
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal types
    are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]


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
    level. Each additional `-v` flag increases verbosity: no flags → `"warning"`,
    `-v` → `"info"`, `-vv` → `"debug"`, `-vvv` → `"trace"`.

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
        show "Description for repro CLI" even though that text describes the
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
    group's label (e.g., "Additional commands:"), which was incorrect.
    The fix compares current command entries against the initial set of
    commands that the group originally labeled; the label is now applied
    only when the visible commands are the group's own top-level commands,
    not commands from a deeper level.  [[#116]]

[#116]: https://github.com/dahlia/optique/issues/116
[#117]: https://github.com/dahlia/optique/issues/117
[#118]: https://github.com/dahlia/optique/issues/118
[#119]: https://github.com/dahlia/optique/issues/119


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

[#114]: https://github.com/dahlia/optique/issues/114


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

[#107]: https://github.com/dahlia/optique/issues/107


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

[#98]: https://github.com/dahlia/optique/issues/98
[#100]: https://github.com/dahlia/optique/issues/100


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

[#95]: https://github.com/dahlia/optique/issues/95


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

[#97]: https://github.com/dahlia/optique/issues/97


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

[#81]: https://github.com/dahlia/optique/issues/81


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
    symbol keys in the parser definition (e.g., `object({ [sym]: option(...) })`),
    the symbol-keyed parsers were silently ignored because `Object.entries()`
    and `for...in` loops do not enumerate symbol properties.  Now, the parser
    correctly handles both string and symbol keys by using `Reflect.ownKeys()`.


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
    or argument found” even though `-o` was a valid option for `sub1`.  [[#67]]


Version 0.7.4
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal types
    are correctly preserved.  For example,
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

[#53]: https://github.com/dahlia/optique/issues/53
[#55]: https://github.com/dahlia/optique/issues/55


Version 0.7.2
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when the input contains only the options terminator `"--"`.
    For example, `parse(withDefault(option("--name", string()), "Bob"), ["--"])`
    now correctly returns `"Bob"` instead of failing with “Missing option
    `--name`.”  [[#50]]


Version 0.7.1
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when used as a standalone parser with empty input.  For
    example, `parse(withDefault(option("--name", string()), "Bob"), [])` now
    correctly returns `"Bob"` instead of failing with “Expected an option,
    but got end of input.”  [[#48]]


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
    arguments) instead of showing generic "No matching option or command found"
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

[#73]: https://github.com/dahlia/optique/issues/73


Version 0.6.10
--------------

Released on January 1, 2026.

### @optique/core

 -  Fixed `object()` parser ignoring symbol keys.  Previously, when using
    symbol keys in the parser definition (e.g., `object({ [sym]: option(...) })`),
    the symbol-keyed parsers were silently ignored because `Object.entries()`
    and `for...in` loops do not enumerate symbol properties.  Now, the parser
    correctly handles both string and symbol keys by using `Reflect.ownKeys()`.


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

[#69]: https://github.com/dahlia/optique/issues/69


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

[#68]: https://github.com/dahlia/optique/issues/68


Version 0.6.7
-------------

Released on December 30, 2025.

### @optique/core

 -  Fixed `merge()` breaking option parsing inside subcommands when merged with
    `or()`.  Previously, when using `merge(globalOptions, or(sub1, sub2))`,
    options inside the subcommands would fail to parse after the subcommand was
    selected.  For example, `sub1 -o foo` would fail with “No matching option
    or argument found” even though `-o` was a valid option for `sub1`.  [[#67]]

[#67]: https://github.com/dahlia/optique/issues/67


Version 0.6.6
-------------

Released on December 21, 2025.

### @optique/core

 -  Fixed `withDefault()` widening literal types in its default value parameter.
    Previously, passing a literal type as the default value would cause type
    widening (e.g., `"auto"` → `string`, `42` → `number`).  Now literal types
    are correctly preserved.  For example,
    `withDefault(option("--format", choice(["auto", "text"])), "auto")` now
    correctly infers `"auto" | "text"` instead of `string`.  [[#58]]

[#58]: https://github.com/dahlia/optique/issues/58


Version 0.6.5
-------------

Released on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when the input contains only the options terminator `"--"`.
    For example, `parse(withDefault(option("--name", string()), "Bob"), ["--"])`
    now correctly returns `"Bob"` instead of failing with “Missing option
    `--name`.”  [[#50]]

[#50]: https://github.com/dahlia/optique/issues/50


Version 0.6.4
-------------

Rleased on December 2, 2025.

### @optique/core

 -  Fixed `optional()` and `withDefault()` returning an error instead of the
    expected value when used as a standalone parser with empty input.  For
    example, `parse(withDefault(option("--name", string()), "Bob"), [])` now
    correctly returns `"Bob"` instead of failing with “Expected an option,
    but got end of input.”  [[#48]]

[#48]: https://github.com/dahlia/optique/issues/48


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

[#36]: https://github.com/dahlia/optique/issues/36


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
    `@optique/core/parser` module into focused, specialized modules. This improves
    maintainability, reduces module size, and provides clearer separation of
    concerns. All changes maintain full backward compatibility through re-exports.

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
        and their related types to a dedicated `@optique/core/constructs` module.
        These combinator functions that compose and combine parsers are now
        organized in a separate module.

    For backward compatibility, all functions continue to be re-exported from
    `@optique/core/parser`, so existing code will work unchanged. However, the
    recommended approach going forward is to import directly from the specialized
    modules:

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
    `withDefault()` modifier now accepts an optional third parameter to customize
    how default values are displayed in help text. This allows showing descriptive
    text instead of actual default values, which is particularly useful for
    environment variables, computed defaults, or sensitive information.  [[#19]]

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
        matched” to specific ones like “No matching option or command found.”

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


Version 0.4.3
-------------

Released on September 16, 2025.

### @optique/temporal

 -  Fixed timezone identifier validation failure in Deno 2.5.0. The `timeZone()`
    parser now works correctly with all supported timezones by removing explicit
    zero values for hour, minute, and second fields when creating validation
    `ZonedDateTime` objects. This addresses a regression in Deno 2.5.0's Temporal
    API implementation that rejected zero values for time fields.


Version 0.4.2
-------------

Released on September 10, 2025.

### @optique/run

 -  Fixed dependency resolution bug where *@optique/core* dependency was not
    properly versioned, causing installations to use outdated stable versions
    instead of matching development versions. This resolves type errors and
    message formatting issues when using dev versions.  [[#22]]


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
    doesn't natively support labeling. This enables clean code organization while
    maintaining well-structured help text.  [[#12]]

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

[#20]: https://github.com/dahlia/optique/issues/20


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

[#22]: https://github.com/dahlia/optique/issues/22


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
