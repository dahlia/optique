---
links:
  '#1020': https://github.com/dahlia/optique/issues/1020
  '#1023': https://github.com/dahlia/optique/pull/1023
---
 -  Added support for `showUsage` in discovered subcommand metadata so
    subcommand help can override `runProgram()`'s default.  Descendants inherit
    the nearest explicit ancestor setting, and synthetic namespaces do not
    inherit their descendants' settings.  [[#1020], [#1023]]
