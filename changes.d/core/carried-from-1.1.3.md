 -  Fixed `or()` and `longestMatch()` incorrectly selecting an `option()` or
    `flag()` branch when consuming the `--` options terminator.  Wrapped
    `optional()`/`withDefault()` parsers now return their fallback, and
    positional branches can consume arguments after `--` regardless of branch
    order without evaluating their value parsers more than once.  Zero-consuming
    branches such as `constant()` are selected only after the terminator is
    consumed, without evaluating branch defaults more than once.  Slash- and
    plus-prefixed options receive the same handling, nested fallback branches
    retain their selection, unmatched Boolean options remain unselected, and
    greedy `passThrough()` branches can still capture `--`.  Preserving an
    active `or()` branch no longer evaluates defaults in inactive branches.
    [[#884]]
