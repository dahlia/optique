---
links:
  '#1132': https://github.com/dahlia/optique/issues/1132
  '#1133': https://github.com/dahlia/optique/pull/1133
---
 -  Fixed `runProgram()` to show complete root help for an unknown top-level
    command followed by `--help` when source contexts are registered, instead
    of throwing a `TypeError` or omitting nested command paths.
    [[#1132], [#1133]]
