---
links:
  '#1031': https://github.com/dahlia/optique/issues/1031
  '#1033': https://github.com/dahlia/optique/pull/1033
---
 -  Fixed Bash completion of values in `--option=value` form with the default
    or customized word-break settings, including file paths and values
    containing `:` or `@`.  Quoted and escaped joined values are decoded
    without expanding shell substitutions.  File completion now preserves
    values containing `=` when choosing file types and extensions.
    [[#1031], [#1033]]
