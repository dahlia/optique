---
links:
  '#1102': https://github.com/dahlia/optique/issues/1102
  '#1106': https://github.com/dahlia/optique/pull/1106
  '#1132': https://github.com/dahlia/optique/issues/1132
  '#1133': https://github.com/dahlia/optique/pull/1133
---
 -  Fixed `runProgram()` root commands consuming registered command names or
    enabled help, version, and completion command names as positional values.
    Registered command results and errors now take precedence over root parsing,
    and meta commands remain reachable without losing root help or completion.
    `createProgramParser()` keeps its existing parser precedence.
    [[#1102], [#1106]]
 -  Fixed `runProgram()` to show complete root help for an unknown top-level
    command followed by `--help` when source contexts are registered, instead
    of throwing a `TypeError` or omitting nested command paths.
    [[#1132], [#1133]]
