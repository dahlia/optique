---
links:
  '#1103': https://github.com/dahlia/optique/issues/1103
  '#1138': https://github.com/dahlia/optique/pull/1138
---
 -  Added `defaultCommand` to `runProgram()` and `default: true` to command
    definitions. A command can serve as both a named subcommand and the
    fallback when the first token matches no registered or enabled runner
    entry point. Root help includes its arguments and options, and shell
    completion can suggest its positional values.  [[#1103], [#1138]]
