---
links:
  '#1054': https://github.com/dahlia/optique/issues/1054
  '#1075': https://github.com/dahlia/optique/pull/1075
---
 -  Fixed Zsh completion to offer initial matches for relative file globs such
    as _tmp/fixtures/\*.txt_ when the current value is empty, including
    file suggestions with `type: "any"`, which can match FIFOs.  File extension
    filters still apply to these matches, and subdirectories remain available
    for navigation.  Directory-only suggestions now also offer initial matches,
    limited to directories whose names match the glob.  [[#1054], [#1075]]
