Optique changelog
=================

Version 0.3.0
-------------

To be released.

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
