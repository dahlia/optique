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
 -  Fixed cancellation while a prompt configuration resolver is pending:
    parsing now rejects immediately with the abort reason instead of
    waiting for the resolver to finish. Resolvers with or without dependency
    sources receive the prompt's abort `signal` so they can also cancel
    their own work.  [[#964], [#979]]
