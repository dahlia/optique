---
links:
  '#1025': https://github.com/dahlia/optique/issues/1025
  '#1095': https://github.com/dahlia/optique/pull/1095
---
 -  Added `collectDocPages()` in `@optique/core/doc-pages` to collect command
    documentation from supported built-in definitions without parsing or
    evaluating runtime callbacks. Collection fails by default if a visible
    scope cannot be documented. Supply replacement pages or subtrees, or
    pass `strict: false` to receive partial results with explicit gaps.
    [[#1025], [#1095]]
