---
links:
  '#1102': https://github.com/dahlia/optique/issues/1102
  '#1106': https://github.com/dahlia/optique/pull/1106
---
 -  Fixed `runProgram()` root commands consuming registered command names or
    enabled help, version, and completion command names as positional values.
    Registered command results and errors now take precedence over root parsing,
    and meta commands remain reachable without losing root help or completion.
    `createProgramParser()` keeps its existing parser precedence.
    [[#1102], [#1106]]
