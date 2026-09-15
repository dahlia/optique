---
links:
  '#960': https://github.com/dahlia/optique/issues/960
---
 -  Fixed `bindEnv()` replacing explicit command-line values with environment
    values when `tuple()` or `concat()` revisited the parser without consuming
    input.  An option terminator alone now leaves environment fallback
    available.  Nested config fallback also keeps its annotations across
    reparses when the environment variable is absent.
    [[#960]]
