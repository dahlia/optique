---
links:
  '#1103': https://github.com/dahlia/optique/issues/1103
  '#1138': https://github.com/dahlia/optique/pull/1138
---
 -  Added an opt-in fallback to `runProgram()` for invocations that do not
    start with a registered command, alias, or enabled runner entry point.
    Set `default: true` on a registered command to also run it by name, or
    pass `defaultCommand` without registering a name for it, even if no
    other commands are discovered. Root help includes the fallback's
    arguments and options, and shell completion can suggest its positional
    values.  [[#1103], [#1138]]
