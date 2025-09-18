Optique changelog
=================

Version 0.4.5
-------------

To be released.


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
