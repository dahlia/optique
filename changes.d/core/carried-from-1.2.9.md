---
links:
  '#988': https://github.com/dahlia/optique/issues/988
  '#990': https://github.com/dahlia/optique/issues/990
  '#991': https://github.com/dahlia/optique/issues/991
  '#992': https://github.com/dahlia/optique/pull/992
  '#993': https://github.com/dahlia/optique/pull/993
  '#995': https://github.com/dahlia/optique/pull/995
---
 -  Reduced typo suggestion overhead when option parsers encounter positional
    arguments.  Literal `errors.noMatch` messages now skip suggestion searches,
    and candidates whose length difference exceeds the suggestion thresholds
    are excluded before calculating edit distances.  Suggestion results and
    custom error callback invocations are preserved.
    [[#988], [#992]]
 -  Fixed `passThrough()` hiding errors for known options in `object()`,
    `tuple()`, and `concat()`, including missing values and Boolean options
    given attached values.  Unknown options are still forwarded, and ordinary
    alternative parsers can still recover from consuming failures.
    [[#991], [#993]]
 -  Fixed `argument()` accepting joined option tokens such as `--name=value`
    as positional arguments before `--`.  Unknown joined options now reach
    `passThrough()`, and errors from known options are no longer hidden by
    positional arguments.  Use `--` to pass joined option tokens as literal
    positional arguments.
    [[#990], [#995]]
