---
links:
  '#1050': https://github.com/dahlia/optique/issues/1050
  '#1074': https://github.com/dahlia/optique/pull/1074
---
 -  Fixed file value completion in `keyValue()` to match the value path while
    retaining the key and separator in inserted candidates.  [[#1050], [#1074]]

    Regenerate installed shell completion scripts after upgrading.  Bash still
    requires removing the separator from `COMP_WORDBREAKS` so completion
    receives the key/value as one word.
