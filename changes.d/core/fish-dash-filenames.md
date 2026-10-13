---
links:
  '#1036': https://github.com/dahlia/optique/issues/1036
  '#1059': https://github.com/dahlia/optique/pull/1059
---
 -  Fixed fish file completion to suggest filenames that start with a dash,
    such as `-n`, `-e`, or `-s`, which were previously missing from the
    candidates.  Completing dash-prefixed paths no longer prints `basename`
    errors to the terminal either.  [[#1036], [#1059]]
