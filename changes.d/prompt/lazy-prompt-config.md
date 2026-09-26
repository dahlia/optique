---
links:
  '#964': https://github.com/dahlia/optique/issues/964
  '#979': https://github.com/dahlia/optique/pull/979
---
 -  Added a `derivePromptConfig()` form that takes only a resolver, for
    prompt configurations that depend on no parsed value but have to be
    loaded, such as choices fetched from a remote service.  The resolver runs
    only at the real prompt fallback, so command-line values, source
    bindings, help, and suggestions never trigger it.  The new
    `DerivePromptConfigNoDepsContext` and `DerivePromptConfigNoDepsOptions`
    types describe its context and options.  [[#964], [#979]]
 -  Derived prompt configuration resolvers now receive the prompt's abort
    `signal` in their context, and aborting while a resolver is pending now
    rejects parsing right away with the signal's reason.  Previously, the
    abort was observed only after the resolver settled.  [[#964], [#979]]
