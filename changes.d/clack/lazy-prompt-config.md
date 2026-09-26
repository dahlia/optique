---
links:
  '#964': https://github.com/dahlia/optique/issues/964
  '#979': https://github.com/dahlia/optique/pull/979
---
 -  `prompt()` now accepts a `derivePromptConfig()` result without
    dependency sources, so a selection prompt can load its options
    asynchronously right before it opens.  The resolver receives the abort
    `signal` from the shared options.  The new
    `DerivePromptConfigNoDepsContext` and `DerivePromptConfigNoDepsOptions`
    types are re-exported for convenience.  [[#964], [#979]]
