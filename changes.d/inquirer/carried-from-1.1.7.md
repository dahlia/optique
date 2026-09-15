---
links:
  '#960': https://github.com/dahlia/optique/issues/960
---
 -  Fixed `prompt()` losing an explicit command-line value when `tuple()` or
    `concat()` revisited it without consuming more input.  The value is now
    preserved instead of prompting again and replacing it.
    [[#960]]
