---
links:
  '#1051': https://github.com/dahlia/optique/issues/1051
  '#1066': https://github.com/dahlia/optique/pull/1066
---
 -  Fixed shell completion values starting with `__FILE__:` being interpreted
    as file completion requests instead of literal suggestions.
    [[#1051], [#1066]]

    Regenerate saved completion scripts after upgrading.  Custom completion
    producers/adapters must encode/decode the `__LITERAL__:` escape for values
    starting with `__FILE__:` or `__LITERAL__:`.
