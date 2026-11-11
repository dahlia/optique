---
links:
  '#1108': https://github.com/dahlia/optique/issues/1108
  '#1109': https://github.com/dahlia/optique/pull/1109
---
 -  Fixed `map()` losing `bindEnv()` and `bindConfig()` fallbacks inside
    composed commands, and making `prompt()` skip mapped `optional()` or
    `withDefault()` parsers when context annotations were present.
    [[#1108], [#1109]]
