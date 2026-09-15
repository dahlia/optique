---
links:
  '#960': https://github.com/dahlia/optique/issues/960
---
 -  Fixed `bindConfig()` replacing explicit command-line values with config
    values when `tuple()` or `concat()` revisited the parser without consuming
    input.  An option terminator alone now leaves config fallback available.
    [[#960]]
