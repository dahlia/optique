---
links:
  '#994': https://github.com/dahlia/optique/issues/994
  '#996': https://github.com/dahlia/optique/pull/996
---
 -  Fixed known option errors being hidden by `passThrough()` when a
    zero-consuming `longestMatch()` fallback is nested inside containers,
    `or()`, optional or repeated parsers, or source bindings.  Missing values
    now retain their original diagnostics through these compositions, while
    ordinary alternatives and higher-priority capture can still recover.
    Repeated parsers also check fresh item options before forwarding input.
    [[#994], [#996]]
