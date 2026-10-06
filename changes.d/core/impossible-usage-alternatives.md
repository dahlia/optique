---
links:
  '#1004': https://github.com/dahlia/optique/issues/1004
  '#1012': https://github.com/dahlia/optique/pull/1012
---
 -  Fixed usage descriptions for `or(fail(), ...)` to omit the failing branch,
    so required alternatives no longer appear optional in man page SYNOPSIS.
    `fail().usage` now represents no successful alternatives, distinguishing
    it from the empty usage of `constant()`.  [[#1004], [#1012]]
