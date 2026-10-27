---
links:
  '#1025': https://github.com/dahlia/optique/issues/1025
  '#1095': https://github.com/dahlia/optique/pull/1095
---
 -  Added `collectDocPages()` in `@optique/core/doc-pages` to collect command
    documentation from supported built-in definitions without parsing or
    evaluating runtime callbacks. Unsupported scopes are reported explicitly,
    with strict failure and authored page/subtree replacements.
    [[#1025], [#1095]]
