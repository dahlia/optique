---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#870': https://github.com/dahlia/optique/issues/870
  '#912': https://github.com/dahlia/optique/pull/912
---
 -  Fixed dependency sources completed by a prompt fallback to register
    their value in the dependency runtime, so a parser derived from such a
    source now sees the value the user actually selected instead of the
    source's default.  A derived parser now behaves identically whether its
    dependency value came from the command line or from an interactive
    prompt, across `object()`, `tuple()`, `seq()`, `concat()`, and
    `merge()` compositions—including sources nested in child constructs
    such as `concat()` child tuples, and sources transformed with `map()`,
    which register their pre-transform value.  Interactive source
    completions run serially in
    declaration order before dependency replay, at most once per parse
    operation, and never during help, suggestion, or probe phases; a
    cancelled prompt fails the parse without running later prompts.  Under
    `runWith()` with two-pass source contexts, a source prompt now runs at
    most once per run: it runs during the seed pass only when a phase-one
    consumer demands its value and otherwise defers to the final pass, so
    an undemanded source prompt no longer exposes its value to phase-two
    contexts.  [[#869], [#870], [#912]]
