---
links:
  '#903': https://github.com/dahlia/optique/issues/903
  '#955': https://github.com/dahlia/optique/pull/955
---
 -  Improved automatic color and width defaults for help, usage, and errors
    from `run()`, `runSync()`, and `runAsync()`.

    Any nonempty `FORCE_COLOR` enables colors, including `0`; otherwise a
    nonempty `NO_COLOR` or any `NODE_DISABLE_COLORS` disables them. Empty
    `FORCE_COLOR` and `NO_COLOR` values are ignored. Explicit `colors` still
    takes precedence.

    Invalid reported terminal widths now fall back to a positive decimal
    `COLUMNS` value, or leave output unwrapped when neither is valid.
    Explicit `maxWidth` keeps its existing validation. Deno ignores
    inaccessible environment variables without requesting permission.
    These defaults do not change the printer functions.  [[#903], [#955]]
