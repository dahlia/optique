---
links:
  '#1026': https://github.com/dahlia/optique/issues/1026
  '#1027': https://github.com/dahlia/optique/pull/1027
---
 -  Added opt-in help for bare command groups through `runProgram()`'s
    `help.bareGroup` setting.  Use `"namespace"` for groups without their own
    command definition or `"always"` to show help instead of executing bare
    parent commands.  Existing behavior remains the default.  [[#1026], [#1027]]
