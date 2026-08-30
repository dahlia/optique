---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#872': https://github.com/dahlia/optique/issues/872
---
 -  Added support for prompt configurations derived from dependency sources.
    `prompt()` now also accepts a `derivePromptConfig()` result whose
    resolver returns any of this package's prompt configurations, exposed
    through the new `RuntimePromptConfig` union, so a later question can
    adapt its options to earlier answers.  `derivePromptConfig()` and its
    types are re-exported for convenience.  [[#869], [#872]]
